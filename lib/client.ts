// 브라우저 전용 유틸: 이미지 축소, HTML 정리, PDF 생성

// PDF의 한 페이지를 큰 캔버스로 그린다 (그림을 잘라내기 위한 용도).
async function renderPdfPage(file: Blob, pageNo: number, cache: { doc?: Promise<unknown> }): Promise<HTMLCanvasElement | null> {
  try {
    const pdfjs = await import("pdfjs-dist");
    pdfjs.GlobalWorkerOptions.workerSrc = new URL("pdfjs-dist/build/pdf.worker.min.mjs", import.meta.url).toString();
    cache.doc ??= file.arrayBuffer().then((data) => pdfjs.getDocument({ data }).promise);
    const doc = (await cache.doc) as Awaited<ReturnType<typeof pdfjs.getDocument>["promise"]>;
    if (pageNo < 1 || pageNo > doc.numPages) return null;
    const page = await doc.getPage(pageNo);
    const base = page.getViewport({ scale: 1 });
    const viewport = page.getViewport({ scale: Math.min(3, 2400 / Math.max(base.width, base.height)) });
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(viewport.width);
    canvas.height = Math.round(viewport.height);
    await page.render({ canvas, viewport }).promise;
    return canvas;
  } catch {
    return null;
  }
}

// AI가 표시한 <figure data-file data-box [data-page]>를 사진/PDF 페이지에서 잘라낸 그림으로 바꾼다.
// sources[i]는 (i+1)번째로 올린 파일. 좌표는 0~1000 정규화 값이라 해상도와 무관하다.
export async function embedFigures(html: string, sources: Blob[]): Promise<string> {
  const doc = new DOMParser().parseFromString("<div>" + html + "</div>", "text/html");
  const root = doc.body.firstElementChild as HTMLElement;
  type Src = { img: CanvasImageSource; width: number; height: number } | null;
  const cache = new Map<string, Src>();
  const pdfDocs = new Map<number, { doc?: Promise<unknown> }>();
  const sourceOf = async (i: number, page: number): Promise<Src> => {
    const src = sources[i];
    if (!src) return null;
    const isPdf = src.type === "application/pdf";
    const key = `${i}:${isPdf ? page : 0}`;
    if (!cache.has(key)) {
      let r: Src = null;
      if (isPdf) {
        if (!pdfDocs.has(i)) pdfDocs.set(i, {});
        const c = await renderPdfPage(src, page, pdfDocs.get(i)!);
        if (c) r = { img: c, width: c.width, height: c.height };
      } else {
        const bm = await createImageBitmap(src).catch(() => null);
        if (bm) r = { img: bm, width: bm.width, height: bm.height };
      }
      cache.set(key, r);
    }
    return cache.get(key) ?? null;
  };
  for (const fig of [...root.querySelectorAll<HTMLElement>("figure")]) {
    const idx = Number(fig.dataset.file) - 1;
    const box = (fig.dataset.box ?? "").split(",").map(Number);
    const bm = Number.isInteger(idx) ? await sourceOf(idx, Number(fig.dataset.page) || 1) : null;
    const ok = bm && box.length === 4 && box.every((n) => Number.isFinite(n));
    if (!ok) {
      fig.remove();
      continue;
    }
    // 가장자리에 1.5% 여유를 두고 범위 안으로 맞춘다.
    const pad = 15;
    const [x0, y0, x1, y1] = [
      Math.max(0, Math.min(box[0], box[2]) - pad),
      Math.max(0, Math.min(box[1], box[3]) - pad),
      Math.min(1000, Math.max(box[0], box[2]) + pad),
      Math.min(1000, Math.max(box[1], box[3]) + pad),
    ];
    if (x1 - x0 < 30 || y1 - y0 < 30) {
      fig.remove();
      continue;
    }
    const sx = (x0 / 1000) * bm.width, sy = (y0 / 1000) * bm.height;
    const sw = ((x1 - x0) / 1000) * bm.width, sh = ((y1 - y0) / 1000) * bm.height;
    const c = document.createElement("canvas");
    c.width = Math.round(sw);
    c.height = Math.round(sh);
    c.getContext("2d")!.drawImage(bm.img, sx, sy, sw, sh, 0, 0, c.width, c.height);
    const img = doc.createElement("img");
    img.src = c.toDataURL("image/jpeg", 0.9);
    img.alt = "";
    fig.replaceChildren(img);
    fig.removeAttribute("data-file");
    fig.removeAttribute("data-box");
    fig.removeAttribute("data-page");
    // 시험지 폭 대비 원본 그림의 가로 비율 (최대 100%)
    fig.dataset.w = String(Math.min(100, Math.round((x1 - x0) / 10)));
    fig.style.width = fig.dataset.w + "%";
  }
  return root.innerHTML;
}

export async function shrink(f: File): Promise<Blob> {
  try {
    const bm = await createImageBitmap(f);
    const s = Math.min(1, 1800 / Math.max(bm.width, bm.height));
    const c = document.createElement("canvas");
    c.width = Math.round(bm.width * s);
    c.height = Math.round(bm.height * s);
    c.getContext("2d")!.drawImage(bm, 0, 0, c.width, c.height);
    const b = await new Promise<Blob | null>((r) => c.toBlob(r, "image/jpeg", 0.88));
    return b ?? f;
  } catch {
    return f;
  }
}

const ALLOWED = new Set([
  "DIV", "SPAN", "P", "B", "STRONG", "I", "EM", "U", "BR", "H2", "H3",
  "TABLE", "THEAD", "TBODY", "TR", "TD", "TH", "OL", "UL", "LI", "SUP", "SUB", "FIGURE",
]);
const ALLOWED_ATTRS = new Set(["class", "colspan", "rowspan", "data-file", "data-page", "data-box", "data-pairs"]);

// AI 출력에서 허용된 태그·속성만 남긴다.
export function clean(h: string): string {
  h = h.replace(/^```(?:html)?\s*/i, "").replace(/```\s*$/, "");
  const d = new DOMParser().parseFromString("<div>" + h + "</div>", "text/html");
  const root = d.body.firstElementChild as HTMLElement;
  const walk = (el: Element) => {
    for (const child of [...el.children]) {
      if (!ALLOWED.has(child.tagName)) {
        if (/^(SCRIPT|STYLE|IFRAME|OBJECT|EMBED|LINK|META)$/.test(child.tagName)) child.remove();
        else child.replaceWith(...child.childNodes);
        continue;
      }
      for (const a of [...child.attributes]) if (!ALLOWED_ATTRS.has(a.name)) child.removeAttribute(a.name);
      walk(child);
    }
  };
  // replaceWith가 자식을 끌어올리므로 변화가 없을 때까지 반복
  let prev = "";
  while (prev !== root.innerHTML) {
    prev = root.innerHTML;
    walk(root);
  }
  return root.innerHTML;
}

// 시험지는 .pagebreak 표식(= 올린 사진/PDF 페이지의 경계)마다 새 PDF 페이지에서 시작한다.
// 한 구간이 A4 한 장보다 길면 다음 장으로 이어진다.
export async function makePdf(el: HTMLElement): Promise<Blob> {
  const [{ default: html2canvas }, { jsPDF }] = await Promise.all([import("html2canvas"), import("jspdf")]);
  el.classList.add("exporting");
  let canvas: HTMLCanvasElement;
  let cuts: [number, number][]; // 캔버스 픽셀 기준 [구간 시작, 구간 끝]
  try {
    const box = el.getBoundingClientRect();
    canvas = await html2canvas(el, { scale: 2, backgroundColor: "#ffffff" });
    const k = canvas.width / box.width;
    cuts = [];
    let start = 0;
    for (const br of el.querySelectorAll<HTMLElement>(".pagebreak")) {
      const r = br.getBoundingClientRect();
      cuts.push([start, Math.round((r.top - box.top) * k)]);
      start = Math.round((r.bottom - box.top) * k);
    }
    cuts.push([start, canvas.height]);
  } finally {
    el.classList.remove("exporting");
  }

  const pdf = new jsPDF({ unit: "mm", format: "a4" });
  const M = 6, W = 210 - M * 2, H = 297 - M * 2;
  const ph = Math.floor((canvas.width * H) / W);
  let first = true;
  for (const [from, to] of cuts) {
    if (to - from < 20) continue; // 빈 구간은 건너뜀
    for (let y = from; y < to; y += ph) {
      const sh = Math.min(ph, to - y);
      const pc = document.createElement("canvas");
      pc.width = canvas.width;
      pc.height = sh;
      const cx = pc.getContext("2d")!;
      cx.fillStyle = "#fff";
      cx.fillRect(0, 0, pc.width, sh);
      cx.drawImage(canvas, 0, y, canvas.width, sh, 0, 0, canvas.width, sh);
      if (!first) pdf.addPage();
      first = false;
      pdf.addImage(pc.toDataURL("image/jpeg", 0.92), "JPEG", M, M, W, (sh * W) / canvas.width);
    }
  }
  return pdf.output("blob");
}

// 쪽(.page) 하나를 PDF 한 장으로 (예상문제 시험지처럼 화면에서 이미 A4로 배치된 경우)
export async function makePagesPdf(el: HTMLElement): Promise<Blob> {
  const [{ default: html2canvas }, { jsPDF }] = await Promise.all([import("html2canvas"), import("jspdf")]);
  const pdf = new jsPDF({ unit: "mm", format: "a4" });
  el.classList.add("exporting");
  try {
    const pages = [...el.querySelectorAll<HTMLElement>(".page")];
    for (const [i, page] of pages.entries()) {
      const canvas = await html2canvas(page, { scale: 2, backgroundColor: "#ffffff" });
      if (i) pdf.addPage();
      pdf.addImage(canvas.toDataURL("image/jpeg", 0.92), "JPEG", 0, 0, 210, 297);
    }
  } finally {
    el.classList.remove("exporting");
  }
  return pdf.output("blob");
}

export function download(name: string, blob: Blob) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
