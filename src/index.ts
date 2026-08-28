import { buildApp } from "./app.js";
import { SubstackSource } from "./substack.js";

const substackUrl = process.env.SUBSTACK_URL ?? "https://rimaslogic.substack.com";
const port = Number(process.env.PORT ?? 3000);

const source = new SubstackSource(substackUrl);
buildApp(source).listen(port, () => {
  console.log(`rimaslogic-mcp listening on :${port}, source ${substackUrl}`);
});
source.getCorpus().then(
  (c) => console.log(`warmed cache: ${c.articles.length} articles`),
  (e) => console.error(`cache warm failed: ${e}`),
);
