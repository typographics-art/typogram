import { posix } from 'node:path';

// A file read as /llms-full.txt or from about/ has no repository around it: relative links would lead nowhere.
// Each one is resolved against the file it came from and made absolute: to the website when the build publishes
// that file (scripts/build-site.mjs), otherwise to the repository on GitHub. Anchors inside the same part stay.
const SITE = 'https://typographics-art.org/', REPO = 'https://github.com/typ0graphic5/tg-art/';
const onSite = (path) => /^(docs\/|about\/|samples\/|gallery\/(?!works\.config\.json)|assets\/(?!brand\.html)|examples\/(motifs\/|[^/]+\/(onepage\.pdf|preview\.jpg|source\.txt)$))/.test(path)
  || /^(index|app|gallery|examples|work)\.html$|^llms\.txt$|^favicon\.svg$/.test(path);
/** Markdown `md` that came from `file` (a repository path), with every relative link made absolute. */
export function absolutize(md, file) {
  return md.replace(/(?<!!)\[([^\]]+)\]\(([^)\s]+)((?:\s+"[^"]*")?)\)/g, (all, text, target, title) => {
    if (/^[a-z][a-z0-9+.-]*:/i.test(target) || target.startsWith('#') || target.startsWith('//')) return all;
    const [rel, anchor] = target.split('#');
    const path = posix.normalize(posix.join(posix.dirname(file), rel));
    if (path.startsWith('..')) return all;
    const url = onSite(path) ? SITE + path : REPO + (/\.[a-z0-9]+$/i.test(path) ? 'blob/main/' : 'tree/main/') + path.replace(/\/$/, '');
    return `[${text}](${url}${anchor ? '#' + anchor : ''}${title})`;
  });
}

