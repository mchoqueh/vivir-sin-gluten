import type { MetadataRoute } from "next";
import { prisma } from "@/lib/db";
import { siteUrl } from "@/lib/utils";

export const dynamic = "force-dynamic";

type SitemapProduct = {
  id: string;
  updatedAt: Date;
};

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const baseUrl = siteUrl();
  const products: SitemapProduct[] = await prisma.officialItem.findMany({
    where: { active: true },
    select: {
      id: true,
      updatedAt: true,
    },
    orderBy: { updatedAt: "desc" },
    take: 5000,
  });

  return [
    {
      url: baseUrl,
      lastModified: new Date(),
      changeFrequency: "weekly",
      priority: 1,
    },
    {
      url: `${baseUrl}/buscar`,
      lastModified: new Date(),
      changeFrequency: "daily",
      priority: 0.9,
    },
    {
      url: `${baseUrl}/escanear`,
      lastModified: new Date(),
      changeFrequency: "weekly",
      priority: 0.8,
    },
    ...products.map((product) => ({
      url: `${baseUrl}/producto/${product.id}`,
      lastModified: product.updatedAt,
      changeFrequency: "weekly" as const,
      priority: 0.6,
    })),
  ];
}
