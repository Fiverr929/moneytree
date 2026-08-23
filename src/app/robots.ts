import type { MetadataRoute } from "next";

const SITE_URL = "https://cafehtml.net";

export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: "*",
      allow: "/",
      disallow: [
        "/api/",
        "/login",
        "/mask-test",
        "/music-test",
        "/vector-test",
      ],
    },
    sitemap: `${SITE_URL}/sitemap.xml`,
    host: SITE_URL,
  };
}
