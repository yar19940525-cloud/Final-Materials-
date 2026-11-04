import type { NextConfig } from "next";
import { initOpenNextCloudflareForDev } from "@opennextjs/cloudflare";

// `next dev`로 로컬에서 돌릴 때 R2 같은 클라우드플레어 바인딩을 쓸 수 있게 한다 (배포·빌드에는 영향 없음)
if (process.env.NODE_ENV === "development") initOpenNextCloudflareForDev();

// 검색엔진·미리보기·보관(캐시) 서비스에서 이 사이트가 노출되지 않도록 모든 응답에 헤더를 붙인다.
const nextConfig: NextConfig = {
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "X-Robots-Tag", value: "noindex, nofollow, noarchive, nosnippet, noimageindex, notranslate" },
          { key: "Referrer-Policy", value: "no-referrer" },
        ],
      },
    ];
  },
};

export default nextConfig;
