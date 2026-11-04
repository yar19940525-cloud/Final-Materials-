import type { MetadataRoute } from "next";

// 검색 로봇(구글·네이버·다음·빙 등)의 수집을 모두 막는다. (로봇이 지키는 약속일 뿐이라, 진짜 차단은 로그인이다.)
export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      { userAgent: "*", disallow: "/" },
      { userAgent: ["Googlebot", "Googlebot-Image", "Yeti", "NaverBot", "Daumoa", "Bingbot", "Slurp", "DuckDuckBot", "Baiduspider", "GPTBot", "CCBot", "ClaudeBot", "anthropic-ai", "PerplexityBot"], disallow: "/" },
    ],
  };
}
