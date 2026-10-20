# Accessibility

Typographics Art makes pictures out of text, so people who read with a screen reader, a braille display, a magnifier or the keyboard alone are not a side case here: the whole idea is that **the picture and the words are the same thing, and the words stay readable by machines and by assistive technology**. Anyone should be able to read the works, use the website and the generator, and contribute to this repository.

This page says what we aim for, what we have actually measured, what does not work yet, how to report a barrier, and what to expect when you do. It is written for people who may arrive here after hitting a barrier.

## Priorities

- **Accessibility target:** we work toward [WCAG 2.2 Level AA](https://www.w3.org/TR/WCAG22) for the website and the generator. This is a goal that guides our work, **not a claim of verified conformance**. No independent evaluation has been done.
- **The text is real text.** A work is not a flat image: the picture is set character by character, so a screen reader, copy and paste, or a program reads the exact words, in order. This is measured, not assumed — see [docs/technique.md](docs/technique.md) (rule 2) and [docs/text-fidelity.md](docs/text-fidelity.md).
- **Three equal views of every work** (the [work page](https://typographics-art.org/work)): *Art* (the picture), *Read* (the same text as ordinary structured reading text with headings, an outline and search) and *Machine* (source, identity hash and section IDs). A person who cannot use the picture is not left with less.
- **Keyboard:** the interactive controls of the site and the generator should be reachable and operable by keyboard alone, with a visible focus indicator. Most pages carry a skip link (the small verify page does not, as it has only a few controls); the verify page's drop zone also opens with Enter or Space.
- **Screen readers:** semantic HTML, one `h1` per page, labelled controls, and results announced through a live region (the verify page announces VERIFIED / UNSIGNED / TAMPERED).
- **Language:** each page declares its language (`en`, `de`) and updates it when the language switch is used, so a screen reader pronounces it correctly.
- **Motion and colour:** the pages with motion respect `prefers-reduced-motion`; the site follows the system light or dark setting.

## Contributor expectations

If you change the website, the generator or the documentation:

- **Test before you send.** CI is switched off in this repository, so the gate is local: run `TG_SKIP_BROWSER=1 npm test` (and `npm test` where Chrome is available). There is **no automated accessibility scanner** in the project yet; for user-facing changes please run one yourself (for example [axe DevTools](https://www.deque.com/axe/devtools/) or the [GitHub Accessibility Scanner](https://github.com/github/accessibility-scanner)) and say in the pull request what you found.
- **Do one keyboard-only pass** on anything interactive: the tab order is logical, nothing traps focus, the focus indicator is visible, and every action works with Tab, Shift+Tab, Enter and Space.
- **Spot-check a screen reader** for new components or large content changes: headings and landmarks work, controls have names that match their purpose, state changes (errors, results, toggles) are announced, and the reading order is logical.
- **Documentation and content:** keep the heading order (do not skip levels), use real lists and real headings, write link text that makes sense alone (not "click here"), give images a meaningful `alt` (see the [W3C alt decision tree](https://www.w3.org/WAI/tutorials/images/decision-tree/)), and give a complex image a text description next to it. Do not use colour as the only signal. Content should reflow at 200 % zoom and on a narrow screen.
- **New works and examples:** a work's text must be the real text of its source — the identity hash and `tg verify` check this — and its picture needs a short description (the generator uses the title or first heading — check that it says what the picture shows).
- If you cannot fix a barrier you found, say so in the pull request description rather than leaving it unmentioned.

## Reporting accessibility issues

If something got in your way, please tell us. We treat these reports as expertise, not complaints.

1. **Open an issue** with the [accessibility template](https://github.com/typographics-art/typogram/issues/new?template=accessibility.yml), **or** write to **d0n@typographics-art.org** if you prefer not to use GitHub.
2. Tell us, as far as you are comfortable:
   - what you were trying to do and what happened instead;
   - the page, file or command involved;
   - your browser, operating system and assistive technology, with versions;
   - a screenshot or recording, if you like — it is optional.

You do not need to tell us about any disability or personal circumstances.

### Severity

We assign the severity when we triage; you do not have to.

- **Critical:** you cannot complete a core task (for example, you cannot read a work at all).
- **Serious:** significant difficulty, but a workaround exists.
- **Moderate:** an annoyance or an inconsistent experience.
- **Minor:** little effect on use.

### How we respond

- We acknowledge your report respectfully and say what we understood.
- We explain next steps, known limits and dependencies, and offer a workaround while a fix is in progress.
- We update the issue when the status or the target date changes.
- We may ask you to confirm that a fix resolves the barrier before we close the issue.
- We thank you for helping.

### Resolution targets

This is a small project run by one maintainer (with AI assistance), so these are **aims, not guarantees**; they start when the issue is opened. If we will miss one we say so, share a workaround and give a new date.

- **Critical:** within 30 days. **Serious:** within 60 days. **Moderate and minor:** within 90 days.

## Ownership and maintenance

Accessibility is owned by the **project maintainer (d0n)**. They triage reports, track known barriers (the issues labelled `accessibility`), report status in the issue, and keep this page current. When the maintainer changes, this page and the open accessibility issues are handed over with the repository; the owner named here is updated in the same change.

## Supported environments

What we aim for — **not** what has been tested with every combination (see *Known limitations*):

- **Desktop browsers:** the latest two versions of Chrome, Edge, Firefox and Safari.
- **Mobile browsers:** the latest Mobile Safari and Chrome on Android.
- **Screen readers:** VoiceOver, NVDA, JAWS and TalkBack are the intended targets.
- **Command line:** `tg` and the generator CLI write plain text and exit codes, and work with any terminal screen reader.

## Known limitations

This is what we know, in terms of what you would experience:

- **Not yet tested with real screen readers.** The text and the page structure have been measured in Chrome's accessibility tree and with automated text extraction; they have **not** been tested by people using NVDA, JAWS or VoiceOver. We expect problems we have not found. Please report them.
- **No independent accessibility evaluation** has been done, and we run no automated accessibility scan in a pipeline.
- **The picture can be hard to see.** A work is a picture *because* its letters vary in size, weight and colour, and some are faint on purpose (the darkest parts of a portrait). For people with low vision the picture may be unreadable at a distance or without zoom. The words are always available as plain text in the *Read* view, in the embedded source and by copy and paste. The signed-seal corner and the picture itself carry no meaning that is not also in the text.
- **PDF works are untagged.** The PDFs read back in the right order as text, but they have no heading structure for a screen reader. Use the *Read* view of the work, the SVG or the HTML for structure.
- **Flat images lose the text.** If a work is shared as a screenshot or a photo, the words are gone for assistive technology and OCR reads it poorly. Share the PDF, SVG or HTML.
- **Descriptions of pictures are short.** Each work has a short description of what the picture shows, not a full visual description.
- **Third-party content** (fonts loaded from Google Fonts in some old files, outside links) is outside our control.
- **The generator's picture preview** is a visual preview; the text it will carry is shown next to it, and the downloads contain the same text.

Please open an accessibility issue if you find another barrier.

## Feedback

Accessibility is a practice, not a one-time fix. If you can improve this page or how we work, open an issue or a pull request. Thank you for helping make Typographics Art usable by everyone.
