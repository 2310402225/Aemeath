# Aemeath

> The public source snapshot of Rainzt.cn, the personal blog of Rain

Aemeath is the source code of the personal site maintained by Rain (朝朝听雨), available at [rainzt.cn](https://rainzt.cn/). It is an Astro static site that brings together writing, technical notes, project records, friend links, RSS snapshots, and small tools in one maintainable codebase.

The current public snapshot includes the **V3.4.0** site work: the white-hair essay, article film, Lottie gallery, tool-card recommendations, global reading progress, and the public analytics page.

## What is included

- Articles, archives, categories, tags, and Pagefind search
- About, friend links, RSS snapshots, guestbook, and tools
- Galleries, Lottie animations, and article media
- Responsive layouts, dark mode, page transitions, and configurable sidebars
- Waline comment client and public Umami metrics
- A Chinese-first multilingual interface

## Local development

Requirements:

- Node.js >= 22
- pnpm >= 9

Install dependencies and start the development server:

```bash
pnpm install
pnpm dev
```

Common commands:

```bash
pnpm check       # Astro type and template checks
pnpm build       # Build the static site, search index, and optimized assets
pnpm preview     # Preview the production build
pnpm new-post    # Create a post
pnpm post-studio # Start the local post editor
```

## Repository layout

```text
src/config/       Site, navigation, sidebar, comment, and analytics config
src/content/      Posts and special-page content
src/components/   Astro / Svelte components
src/pages/        Pages and API routes
src/data/         Friend-feed snapshots and changelog data
public/           Static assets published directly
scripts/          Build and content utilities
```

Site configuration lives in `src/config/`. Posts use Markdown or MDX and new posts belong in `src/content/posts/`.

## Public snapshot boundary

This repository contains only public site source, content, and static assets. Deployment-provider configuration, server operations, comment-service server code, mail templates, host details, and credentials are intentionally kept outside the public snapshot. Provide integration secrets through server-side environment configuration.

## License

This project is distributed under the [MIT License](LICENSE). Refer to the repository `LICENSE` file for the applicable copyright and license notices.
