"use client";

import { useEffect, useState } from "react";

interface InstallEvent extends Event {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

// 서비스 워커 등록 + "앱 설치" 버튼 (설치 가능한 브라우저에서만 보인다)
export default function Pwa() {
  const [ev, setEv] = useState<InstallEvent | null>(null);
  const [ios, setIos] = useState(false);

  useEffect(() => {
    if ("serviceWorker" in navigator) {
      // 새 서비스 워커가 제어권을 가져가면(= 새 버전 배포) 화면도 한 번 새로고침해 예전 코드가 남지 않게 한다.
      const hadController = !!navigator.serviceWorker.controller;
      let reloaded = false;
      navigator.serviceWorker.addEventListener("controllerchange", () => {
        if (hadController && !reloaded) {
          reloaded = true;
          location.reload();
        }
      });
      navigator.serviceWorker
        .register("/sw.js")
        .then((reg) => {
          reg.update().catch(() => {});
          document.addEventListener("visibilitychange", () => document.visibilityState === "visible" && reg.update().catch(() => {}));
        })
        .catch(() => {});
    }
    const standalone = window.matchMedia("(display-mode: standalone)").matches || (navigator as { standalone?: boolean }).standalone;
    if (!standalone && /iphone|ipad|ipod/i.test(navigator.userAgent)) setIos(true);
    const onPrompt = (e: Event) => {
      e.preventDefault();
      setEv(e as InstallEvent);
    };
    const onInstalled = () => setEv(null);
    window.addEventListener("beforeinstallprompt", onPrompt);
    window.addEventListener("appinstalled", onInstalled);
    return () => {
      window.removeEventListener("beforeinstallprompt", onPrompt);
      window.removeEventListener("appinstalled", onInstalled);
    };
  }, []);

  if (ev)
    return (
      <button
        className="install"
        onClick={async () => {
          await ev.prompt();
          await ev.userChoice;
          setEv(null);
        }}
      >
        📲 앱으로 설치
      </button>
    );
  if (ios) return <p className="install-tip">📲 설치: 공유 버튼(□↑) → “홈 화면에 추가”</p>;
  return null;
}
