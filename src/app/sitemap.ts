import type { MetadataRoute } from "next";

const SITE_URL = "https://cafehtml.net";

export default function sitemap(): MetadataRoute.Sitemap {
  return [
    {
      url: SITE_URL,
      changeFrequency: "weekly",
      priority: 1,
    },
    {
      url: `${SITE_URL}/video`,
      changeFrequency: "weekly",
      priority: 0.8,
    },
  ];
}
