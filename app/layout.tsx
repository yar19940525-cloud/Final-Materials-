import type { Metadata, Viewport } from "next";
import "./globals.css";
import Pwa from "./pwa";

export const metadata: Metadata = {
  title: "학습지 → 시험지·답지 변환기",
  description: "학습지 사진을 올리면 필기를 지운 시험지와 정답이 표시된 답지를 만들어 줍니다.",
  applicationName: "시험지 변환기",
  icons: { icon: "/icons/icon-192.png", apple: "/icons/apple-touch-icon.png" },
  appleWebApp: { capable: true, title: "시험지 변환기", statusBarStyle: "default" },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: "#2f5bea",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ko">
      <head>
        {/* 예상문제 시험지(명조체)용 웹 글꼴 */}
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="" />
        <link href="https://fonts.googleapis.com/css2?family=Noto+Serif+KR:wght@400;700;900&display=swap" rel="stylesheet" />
      </head>
      <body>
        {children}
        <Pwa />
      </body>
    </html>
  );
}
