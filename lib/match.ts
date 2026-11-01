// 선 잇기(.match) 문제: 왼쪽/오른쪽 항목 옆에 점을 찍고, 정답 선(.ln)을 SVG로 그린다.
// 선은 답지에서만 보인다(CSS). 항목 높이가 바뀌면 다시 호출해 위치를 맞춘다.
const NS = "http://www.w3.org/2000/svg";

export function layoutMatches(root: HTMLElement) {
  for (const m of root.querySelectorAll<HTMLElement>(".match")) {
    m.querySelector(":scope > svg.mlines")?.remove();
    const left = m.querySelector<HTMLElement>(":scope > .ml");
    const right = m.querySelector<HTMLElement>(":scope > .mr");
    if (!left || !right) continue;
    const box = m.getBoundingClientRect();
    if (!box.width) continue;

    const svg = document.createElementNS(NS, "svg");
    svg.setAttribute("class", "mlines");
    svg.setAttribute("width", String(box.width));
    svg.setAttribute("height", String(box.height));
    svg.setAttribute("contenteditable", "false");

    const dots = (col: HTMLElement, side: "l" | "r") =>
      [...col.children].map((it) => {
        const r = it.getBoundingClientRect();
        const p = {
          x: (side === "l" ? r.right - box.left : r.left - box.left) + (side === "l" ? 12 : -12),
          y: r.top - box.top + r.height / 2,
        };
        const c = document.createElementNS(NS, "circle");
        c.setAttribute("cx", String(p.x));
        c.setAttribute("cy", String(p.y));
        c.setAttribute("r", "4");
        c.setAttribute("fill", "#222");
        svg.appendChild(c);
        return p;
      });
    const L = dots(left, "l");
    const R = dots(right, "r");

    for (const pair of (m.dataset.pairs ?? "").split(",")) {
      const [a, b] = pair.split("-").map((n) => Number(n) - 1);
      if (!L[a] || !R[b]) continue;
      const ln = document.createElementNS(NS, "line");
      ln.setAttribute("class", "ln");
      ln.setAttribute("x1", String(L[a].x));
      ln.setAttribute("y1", String(L[a].y));
      ln.setAttribute("x2", String(R[b].x));
      ln.setAttribute("y2", String(R[b].y));
      ln.setAttribute("stroke", "#e00");
      ln.setAttribute("stroke-width", "2");
      ln.setAttribute("stroke-linecap", "round");
      svg.appendChild(ln);
    }
    m.appendChild(svg);
  }
}
