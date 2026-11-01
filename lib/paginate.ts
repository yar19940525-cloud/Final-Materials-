// 예상문제 시험지를 실제 시험지처럼 A4 쪽 단위로 배치한다.
// 머리(.xh)는 첫 쪽 위에 전체 폭으로, 문항 블록(.blk)은 1단 또는 2단(가운데 세로줄)에 위→아래, 왼쪽 단→오른쪽 단 순서로 채운다.
// 블록은 옮겨 다닐 뿐 새로 만들지 않으므로, 화면에서 직접 고친 내용은 다시 배치해도 남는다.

export const PAGE_W = 794; // A4 폭 (96dpi 기준 px)
export const PAGE_H = 1123; // A4 높이

export function paginate(sheet: HTMLElement, columns: 1 | 2) {
  const head = sheet.querySelector<HTMLElement>(".xh");
  const blocks = [...sheet.querySelectorAll<HTMLElement>(".blk")];
  sheet.replaceChildren();

  let cols: HTMLElement[] = [];
  let ci = 0;
  const pages: HTMLElement[] = [];
  const newPage = () => {
    const page = document.createElement("div");
    page.className = "page";
    if (!pages.length && head) page.append(head);
    const body = document.createElement("div");
    body.className = "pbody c" + columns;
    cols = Array.from({ length: columns }, () => {
      const c = document.createElement("div");
      c.className = "col";
      body.append(c);
      return c;
    });
    const foot = document.createElement("div");
    foot.className = "pfoot";
    foot.contentEditable = "false";
    page.append(body, foot);
    sheet.append(page);
    pages.push(page);
    ci = 0;
  };
  const overflows = (c: HTMLElement) => c.scrollHeight > c.clientHeight + 1;

  newPage();
  for (const b of blocks) {
    cols[ci].append(b);
    // 넘치면 다음 단(또는 다음 쪽)으로. 블록 하나가 한 단보다 크면 그대로 둔다.
    while (overflows(cols[ci]) && cols[ci].children.length > 1) {
      b.remove();
      if (++ci >= cols.length) newPage();
      cols[ci].append(b);
    }
  }
  pages.forEach((p, i) => {
    p.querySelector(".pfoot")!.textContent = `- ${i + 1} / ${pages.length} -`;
  });
}

// Word로 내보내기용: 쪽·단 배치를 풀어 머리 → 문항 순서의 평평한 문단 목록으로 만든다.
// 2단 시작 지점(머리 다음)에는 data-colstart 표시를 단다.
export function flatten(sheet: HTMLElement, inlineChoices: boolean): HTMLElement {
  const out = document.createElement("div");
  const head = sheet.querySelector<HTMLElement>(".xh");
  if (head) {
    for (const el of head.querySelectorAll<HTMLElement>(".xh-school, .xh-f, .xh-title, .xh-note")) {
      if (el.classList.contains("xh-school") && !el.textContent?.trim()) continue;
      out.append(el.cloneNode(true));
    }
  }
  let first = true;
  for (const b of sheet.querySelectorAll<HTMLElement>(".blk")) {
    for (const el of [...b.children] as HTMLElement[]) {
      let parts: HTMLElement[];
      if (el.classList.contains("chs")) {
        const chs = [...el.children] as HTMLElement[];
        if (inlineChoices) {
          const p = document.createElement("p");
          p.className = "ch";
          chs.forEach((c, i) => {
            if (i) p.append("    ");
            p.append(...[...c.cloneNode(true).childNodes]);
          });
          parts = [p];
        } else parts = chs.map((c) => c.cloneNode(true) as HTMLElement);
      } else parts = [el.cloneNode(true) as HTMLElement];
      for (const p of parts) {
        if (first) p.dataset.colstart = "1";
        first = false;
        out.append(p);
      }
    }
  }
  return out;
}
