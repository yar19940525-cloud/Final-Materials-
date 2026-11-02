"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const TABS = [
  { href: "/", label: "📄 시험지·답지 변환" },
  { href: "/predict", label: "🎯 직보예상문제" },
  { href: "/hakpeu", label: "📘 학프예상문제" },
  { href: "/dialogue", label: "💬 대화문 빈칸" },
  { href: "/analysis", label: "📊 기출분석 자료" },
  { href: "/cheer", label: "📣 응원 메시지" },
];

// 모든 화면 맨 위의 탭 메뉴
export default function Nav() {
  const path = usePathname();
  return (
    <nav className="nav">
      {TABS.map((t) => (
        <Link key={t.href} href={t.href} className={path === t.href ? "on" : ""}>
          {t.label}
        </Link>
      ))}
    </nav>
  );
}
