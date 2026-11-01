// 화면의 시험지/답지(DOM)를 Word(.docx)로 변환한다. 사용자가 직접 고친 내용도 그대로 반영된다.
import type { Paragraph, Table, TextRun, ImageRun } from "docx";

export type Mode = "test" | "key";

interface Style {
  bold?: boolean;
  italics?: boolean;
  underline?: boolean;
  color?: string;
  hidden?: boolean; // 시험지에서 정답을 가린다 (글자는 공백으로 바꿔 밑줄만 남김)
  size?: number; // 글자 크기 (반 포인트 단위, 20 = 10pt)
  boxed?: boolean; // 글자 테두리 (예상문제 번호 네모 칸)
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
  exam?: boolean; // 예상문제 시험지 모양 (지문 상자·번호 칸·쪽 번호 등, PDF와 같게)
  boxPassage?: boolean; // 지문·<보기>를 테두리 상자에 넣는지
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
      size: s.size,
      border: s.boxed ? { style: d.BorderStyle.SINGLE, size: 8, color: "111111", space: 1 } : undefined,
    });

  const inline = (node: Node, s: Style): TextRun[] => {
    if (node.nodeType === Node.TEXT_NODE) {
      const t = (node.textContent ?? "").replace(/[ \t\n\r\f]+/g, " "); // 줄바꿈 없는 공백(선택지 안)은 그대로 둔다
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
    if (cls.contains("nb")) ns = { ...ns, bold: true, boxed: true };
    if (cls.contains("pt")) ns = { ...ns, bold: false, color: "555555", size: 18 };
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

  // ── 예상문제 시험지 모양 (화면·PDF의 CSS와 맞춘다) ──
  const line = (color = "888888", size = 4) => ({ style: d.BorderStyle.SINGLE, size, color, space: 4 });
  const fieldsTable = (el: HTMLElement): Table => {
    const border = { style: d.BorderStyle.SINGLE, size: 4, color: "777777" };
    const borders = { top: border, bottom: border, left: border, right: border };
    const rows = [...el.querySelectorAll("tr")].map(
      (tr, ri) =>
        new d.TableRow({
          height: { value: ri ? 380 : 300, rule: d.HeightRule.ATLEAST },
          children: [...tr.children].map(
            (c) =>
              new d.TableCell({
                borders,
                width: { size: 900, type: d.WidthType.DXA },
                shading: ri ? undefined : { type: d.ShadingType.CLEAR, fill: "DDDDDD", color: "auto" },
                verticalAlign: d.VerticalAlign.CENTER,
                children: [new d.Paragraph({ alignment: d.AlignmentType.CENTER, children: inlineOf(c, { bold: !ri, size: 17 }) })],
              }),
          ),
        }),
    );
    return new d.Table({ rows, alignment: d.AlignmentType.RIGHT, layout: d.TableLayoutType.FIXED, columnWidths: rows.length ? [...el.querySelector("tr")!.children].map(() => 900) : [] });
  };
  // undefined: 예상문제 전용 블록이 아님 (일반 처리), null: 이 모드에서는 넣지 않음
  const examBlock = (el: HTMLElement): Paragraph | Table | null | undefined => {
    const c = el.classList;
    const last = c.contains("xh-last") ? { bottom: { style: d.BorderStyle.DOUBLE, size: 6, color: "111111", space: 6 } } : undefined;
    if (c.contains("xh-school"))
      return new d.Paragraph({ children: inlineOf(el, { bold: true, size: 22 }), spacing: { after: 0 }, border: last });
    if (c.contains("xh-f")) return fieldsTable(el);
    if (c.contains("xh-title"))
      return new d.Paragraph({
        children: inlineOf(el, { bold: true, size: 32 }),
        alignment: d.AlignmentType.CENTER,
        spacing: { before: 200, after: last ? 200 : 60 },
        border: last,
      });
    if (c.contains("xh-note"))
      return new d.Paragraph({ children: inlineOf(el, { size: 18 }), alignment: d.AlignmentType.CENTER, spacing: { after: 200 }, border: last });
    if (c.contains("xh-end"))
      return new d.Paragraph({ children: inlineOf(el, { bold: true }), alignment: d.AlignmentType.CENTER, spacing: { before: 240 } });
    if (mode === "test" && el.matches(".ans, .exp, .src, .ana")) return null;
    // 발문·지문은 다음 문단과 같은 단에 붙여 문항이 단·쪽 경계에서 끊기지 않게 한다
    if (c.contains("qn")) return new d.Paragraph({ children: inlineOf(el), keepNext: true, keepLines: true, spacing: { before: 320, after: 100, line: 320 } });
    if (c.contains("bx"))
      return new d.Paragraph({
        children: inlineOf(el),
        spacing: { before: 0, after: 0, line: 330 },
        keepNext: true,
        indent: { left: 100, right: 100 },
        border: layout.boxPassage === false ? undefined : { top: line(), bottom: line(), left: line(), right: line() },
      });
    if (c.contains("ch")) return new d.Paragraph({ children: inlineOf(el), spacing: { before: 30, after: 30, line: 320 }, indent: { left: 240 } });
    if (c.contains("wr"))
      return mode === "test" ? new d.Paragraph({ text: "", spacing: { before: 440, after: 0 }, border: { bottom: line("999999") } }) : null;
    if (c.contains("ans")) return new d.Paragraph({ children: inlineOf(el, { color: RED, bold: true }), spacing: { before: 100, after: 40 } });
    if (c.contains("exp"))
      return new d.Paragraph({
        children: inlineOf(el, { color: "333333" }),
        shading: { type: d.ShadingType.CLEAR, fill: "FFF4F4", color: "auto" },
        border: { left: { style: d.BorderStyle.SINGLE, size: 18, color: RED, space: 6 } },
        indent: { left: 120 },
        spacing: { before: 40, after: 40 },
      });
    if (c.contains("src")) return new d.Paragraph({ children: inlineOf(el, { color: "2F5BEA", size: 18 }), spacing: { after: 60 } });
    if (el.tagName === "H2" && c.contains("ana"))
      return new d.Paragraph({ children: inlineOf(el, { bold: true, size: 24 }), spacing: { before: 120, after: 80 } });
    if (c.contains("ana")) return new d.Paragraph({ children: inlineOf(el, { size: 19 }), spacing: { after: 30 } });
    return undefined;
  };

  const body: (Paragraph | Table)[] = [];
  let split = -1; // 2단이 시작되는 위치
  for (const node of [...sheet.childNodes]) {
    if (node instanceof HTMLElement) {
      if (node.dataset.colstart && split < 0) split = body.length;
      if (layout.exam) {
        const p = examBlock(node);
        if (p !== undefined) {
          if (p) body.push(p);
          continue;
        }
      }
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
    styles: { default: { document: { run: { font: FONT, size: layout.exam ? 20 : 21 } } } },
    sections: (() => {
      const page = layout.exam
        ? { size: { width: 11906, height: 16838 }, margin: { top: 794, bottom: 794, left: 737, right: 737, footer: 340 } }
        : { size: { width: 11906, height: 16838 }, margin: { top: 1134, bottom: 1134, left: 1134, right: 1134 } };
      // 쪽 번호 "- 1 / 3 -"
      const footers = layout.exam
        ? {
            default: new d.Footer({
              children: [
                new d.Paragraph({
                  alignment: d.AlignmentType.CENTER,
                  children: [new d.TextRun({ children: ["- ", d.PageNumber.CURRENT, " / ", d.PageNumber.TOTAL_PAGES, " -"], size: 16, color: "444444" })],
                }),
              ],
            }),
          }
        : undefined;
      if (layout.columns !== 2 || split < 0) return [{ properties: { page }, footers, children: body }];
      // 머리는 한 단, 문항은 가운데 세로줄이 있는 2단
      return [
        // 머리 끝에 빈 문단을 하나 두어 단 나눔 표시를 거기에 싣는다 (머리 아래 이중선이 확실히 보이도록)
        {
          properties: { page },
          footers,
          children: [...body.slice(0, split), new d.Paragraph({ children: [], spacing: { before: 0, after: 0, line: 120 } })],
        },
        {
          properties: { page, type: d.SectionType.CONTINUOUS, column: { count: 2, space: 454, separate: true } },
          footers,
          children: body.slice(split).length ? body.slice(split) : [new d.Paragraph("")],
        },
      ];
    })(),
  });
  return d.Packer.toBlob(doc);
}
