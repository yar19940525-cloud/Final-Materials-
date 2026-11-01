// 화면의 시험지/답지(DOM)를 Word(.docx)로 변환한다. 사용자가 직접 고친 내용도 그대로 반영된다.
import type { Paragraph, Table, TextRun, ImageRun } from "docx";

export type Mode = "test" | "key";

interface Style {
  bold?: boolean;
  italics?: boolean;
  underline?: boolean;
  color?: string;
  hidden?: boolean; // 시험지에서 정답을 가린다 (글자는 공백으로 바꿔 밑줄만 남김)
}

const BLANK = "        ";
const RED = "EE0000";

const CONTENT_PX = 640; // A4 본문 폭(약 17cm)을 96dpi 픽셀로 본 값

const dataUrlBytes = (url: string) => Uint8Array.from(atob(url.split(",")[1] ?? ""), (c) => c.charCodeAt(0));

interface Raster {
  data: Uint8Array;
  w: number;
  h: number;
}

// 선 잇기·벤 다이어그램처럼 Word 표로 옮기기 어려운 블록은 그림으로 찍어 넣는다.
async function rasterize(sheet: HTMLElement, mode: Mode): Promise<Map<HTMLElement, Raster>> {
  const out = new Map<HTMLElement, Raster>();
  const blocks = [...sheet.querySelectorAll<HTMLElement>(".match, .venn")];
  if (!blocks.length) return out;
  const { default: html2canvas } = await import("html2canvas");
  const prev = sheet.className;
  sheet.className = `sheet ${mode} exporting`;
  try {
    for (const el of blocks) {
      const canvas = await html2canvas(el, { scale: 2, backgroundColor: "#ffffff" });
      const blob = await new Promise<Blob | null>((r) => canvas.toBlob(r, "image/png"));
      if (blob) out.set(el, { data: new Uint8Array(await blob.arrayBuffer()), w: canvas.width / 2, h: canvas.height / 2 });
    }
  } finally {
    sheet.className = prev;
  }
  return out;
}

export interface DocxLayout {
  columns?: 1 | 2; // data-colstart 표시가 있는 문단부터 2단
  serif?: boolean; // 바탕(명조) 글꼴
}

export async function makeDocx(sheet: HTMLElement, mode: Mode, layout: DocxLayout = {}): Promise<Blob> {
  const d = await import("docx");
  const rasters = await rasterize(sheet, mode);
  const FONT = layout.serif
    ? { ascii: "Batang", hAnsi: "Batang", eastAsia: "바탕" }
    : { ascii: "Malgun Gothic", hAnsi: "Malgun Gothic", eastAsia: "맑은 고딕" };

  const run = (text: string, s: Style): TextRun =>
    new d.TextRun({
      text: s.hidden ? BLANK : text,
      bold: s.bold,
      italics: s.italics,
      underline: s.underline ? { type: d.UnderlineType.SINGLE } : undefined,
      color: s.color,
    });

  const inline = (node: Node, s: Style): TextRun[] => {
    if (node.nodeType === Node.TEXT_NODE) {
      const t = (node.textContent ?? "").replace(/\s+/g, " ");
      return t ? [run(t, s)] : [];
    }
    if (!(node instanceof HTMLElement)) return [];
    let ns = s;
    const cls = node.classList;
    switch (node.tagName) {
      case "BR":
        return [new d.TextRun({ break: 1 })];
      case "FIGURE": {
        const img = node.querySelector("img");
        if (!img?.src.startsWith("data:image/") || !img.naturalWidth) return [];
        const w = Math.max(40, (CONTENT_PX * (Number(node.dataset.w) || 50)) / 100);
        return [
          new d.ImageRun({
            type: img.src.startsWith("data:image/png") ? "png" : "jpg",
            data: dataUrlBytes(img.src),
            transformation: { width: Math.round(w), height: Math.round((w * img.naturalHeight) / img.naturalWidth) },
          }) as unknown as TextRun,
        ];
      }
      case "B":
      case "STRONG":
        ns = { ...s, bold: true };
        break;
      case "I":
      case "EM":
        ns = { ...s, italics: true };
        break;
      case "U":
        ns = { ...s, underline: true };
        break;
    }
    if (cls.contains("a")) ns = mode === "key" ? { ...ns, underline: true, bold: true, color: RED } : { ...ns, underline: true };
    if (cls.contains("k")) ns = mode === "key" ? { ...ns, bold: true, color: RED } : { ...ns, hidden: true };
    if (cls.contains("f")) ns = mode === "key" ? { ...ns, underline: true, bold: true, color: RED } : { ...ns, underline: true, hidden: true };
    return [...node.childNodes].flatMap((c) => inline(c, ns));
  };

  const inlineOf = (el: Node, s: Style = {}) => [...el.childNodes].flatMap((c) => inline(c, s));

  const SPACING = { after: 80, line: 340 };

  const para = (el: HTMLElement): Paragraph => {
    if (el.classList.contains("pagebreak")) return new d.Paragraph({ children: [new d.PageBreak()] });
    const raster = rasters.get(el);
    if (raster) {
      const w = Math.min(CONTENT_PX, raster.w);
      return new d.Paragraph({
        children: [
          new d.ImageRun({
            type: "png",
            data: raster.data,
            transformation: { width: Math.round(w), height: Math.round((w * raster.h) / raster.w) },
          }) as unknown as ImageRun,
        ],
        spacing: SPACING,
      });
    }
    if (el.tagName === "H2" || el.tagName === "H3")
      return new d.Paragraph({
        children: inlineOf(el, { bold: true }),
        spacing: { before: 240, after: 80 },
      });
    if (el.classList.contains("bar"))
      return new d.Paragraph({
        children: inlineOf(el, { bold: true, color: "FFFFFF" }),
        alignment: d.AlignmentType.CENTER,
        shading: { type: d.ShadingType.CLEAR, fill: "333333", color: "auto" },
        spacing: { before: 160, after: 160 },
      });
    if (el.classList.contains("q")) {
      const [left, right] = [...el.children] as HTMLElement[];
      return new d.Paragraph({
        children: [...(left ? inlineOf(left) : []), new d.TextRun({ text: "\t" }), ...(right ? inlineOf(right) : [])],
        tabStops: [{ type: d.TabStopType.RIGHT, position: 9638 }],
        spacing: SPACING,
      });
    }
    return new d.Paragraph({ children: inlineOf(el), spacing: SPACING });
  };

  // 그림 + 옆의 글(.pic-row)은 테두리 있는 2칸 표로 옮긴다.
  const picRow = (el: HTMLElement): Table => {
    const border = { style: d.BorderStyle.SINGLE, size: 4, color: "999999" };
    const borders = { top: border, bottom: border, left: border, right: border };
    const [fig, rest] = [el.querySelector<HTMLElement>(":scope > figure"), el.querySelector<HTMLElement>(":scope > div")];
    const textParas = rest ? [...rest.children].map((c) => para(c as HTMLElement)) : [];
    const cell = (children: Paragraph[], pct: number) =>
      new d.TableCell({
        borders,
        width: { size: pct, type: d.WidthType.PERCENTAGE },
        verticalAlign: d.VerticalAlign.CENTER,
        margins: { top: 80, bottom: 80, left: 120, right: 120 },
        children: children.length ? children : [new d.Paragraph("")],
      });
    return new d.Table({
      width: { size: 100, type: d.WidthType.PERCENTAGE },
      rows: [
        new d.TableRow({
          children: [
            cell(fig ? [new d.Paragraph({ children: inline(fig, {}) })] : [], 32),
            cell(textParas, 68),
          ],
        }),
      ],
    });
  };

  const table = (el: HTMLElement): Table => {
    const border = { style: d.BorderStyle.SINGLE, size: 4, color: "999999" };
    const borders = { top: border, bottom: border, left: border, right: border };
    const rows = [...el.querySelectorAll("tr")].map(
      (tr) =>
        new d.TableRow({
          children: [...tr.children].map((c) => {
            const cell = c as HTMLTableCellElement;
            const isTh = cell.tagName === "TH";
            return new d.TableCell({
              borders,
              columnSpan: cell.colSpan > 1 ? cell.colSpan : undefined,
              rowSpan: cell.rowSpan > 1 ? cell.rowSpan : undefined,
              shading: isTh ? { type: d.ShadingType.CLEAR, fill: "DDDDDD", color: "auto" } : undefined,
              margins: { top: 40, bottom: 40, left: 80, right: 80 },
              verticalAlign: d.VerticalAlign.CENTER,
              children: [
                new d.Paragraph({
                  alignment: d.AlignmentType.CENTER,
                  children: inlineOf(cell, { bold: isTh || el.classList.contains("hd") }),
                }),
              ],
            });
          }),
        }),
    );
    return new d.Table({ rows, width: { size: 100, type: d.WidthType.PERCENTAGE } });
  };

  const body: (Paragraph | Table)[] = [];
  let split = -1; // 2단이 시작되는 위치
  for (const node of [...sheet.childNodes]) {
    if (node instanceof HTMLElement) {
      if (node.dataset.colstart && split < 0) split = body.length;
      // 예상문제 시험지 머리·끝맺음
      if (node.matches(".xh-title, .xh-school, .xh-end")) {
        const title = node.classList.contains("xh-title");
        body.push(
          new d.Paragraph({
            children: inlineOf(node, { bold: true }),
            alignment: d.AlignmentType.CENTER,
            spacing: { before: title ? 160 : 60, after: title ? 160 : 60 },
          }),
        );
        continue;
      }
      // 예상문제: 정답·해설·출제 근거·경향 분석은 답지에만, 답 쓰는 줄은 시험지에만
      if (mode === "test" && node.matches(".ans, .exp, .src, .ana")) continue;
      if (node.classList.contains("wr")) {
        if (mode === "test") body.push(new d.Paragraph({ text: "_".repeat(70), spacing: { before: 240, after: 80 } }));
        continue;
      }
      if (node.classList.contains("ans") || node.classList.contains("exp")) {
        body.push(new d.Paragraph({ children: inlineOf(node, { color: RED, bold: node.classList.contains("ans") }), spacing: SPACING }));
        continue;
      }
      if (node.classList.contains("qn")) {
        body.push(new d.Paragraph({ children: inlineOf(node, { bold: true }), spacing: { before: 280, after: 80 } }));
        continue;
      }
      if (node.tagName === "TABLE") {
        body.push(table(node), new d.Paragraph({ text: "", spacing: { after: 60 } }));
      } else if (node.classList.contains("pic-row")) {
        body.push(picRow(node), new d.Paragraph({ text: "", spacing: { after: 60 } }));
      } else {
        body.push(para(node));
      }
    } else if (node.nodeType === Node.TEXT_NODE && node.textContent?.trim()) {
      body.push(new d.Paragraph({ children: [run(node.textContent.trim(), {})], spacing: SPACING }));
    }
  }
  if (!body.length) body.push(new d.Paragraph({ text: "" }));

  const doc = new d.Document({
    title: mode === "key" ? "답지" : "시험지",
    styles: { default: { document: { run: { font: FONT, size: 21 } } } },
    sections: (() => {
      const page = { size: { width: 11906, height: 16838 }, margin: { top: 1134, bottom: 1134, left: 1134, right: 1134 } };
      if (layout.columns !== 2 || split < 0) return [{ properties: { page }, children: body }];
      // 머리는 한 단, 문항은 가운데 세로줄이 있는 2단
      return [
        { properties: { page }, children: split > 0 ? body.slice(0, split) : [new d.Paragraph("")] },
        {
          properties: { page, type: d.SectionType.CONTINUOUS, column: { count: 2, space: 567, separate: true } },
          children: body.slice(split).length ? body.slice(split) : [new d.Paragraph("")],
        },
      ];
    })(),
  });
  return d.Packer.toBlob(doc);
}
