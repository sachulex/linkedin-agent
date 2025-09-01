import crawlSite from "./index";

const [startUrl = "https://example.com", maxPagesArg = "5", maxDepthArg = "1"] = process.argv.slice(2);
const maxPages = Number(maxPagesArg);
const maxDepth = Number(maxDepthArg);

(async () => {
  const result = await crawlSite({
    startUrl,
    maxPages,
    maxDepth,
    userAgent: "WebsiteResearchBot/0.1",
  });

  console.log(JSON.stringify({
    meta: { startUrl, maxPages, maxDepth, pages: result.pages.length, errors: result.errors.length },
    pages: result.pages.map(p => ({
      url: p.url,
      depth: p.depth,
      status: p.status,
      title: p.title,
      contentType: p.contentType,
      parentUrl: p.parentUrl,
    })),
    errors: result.errors,
  }, null, 2));
})();
