# muhamad0x — Personal Security Blog

Jekyll blog hosted on GitHub Pages.

**Live:** https://muhamad0x.github.io

## Adding a New Post

Create a file in `_posts/` with the format:

```
_posts/YYYY-MM-DD-post-title.md
```

Front matter:

```yaml
---
layout: post
title: "Your Post Title"
date: 2025-03-22
category: "Bug Bounty"      # Bug Bounty | Red Team | Malware Dev | Write-ups
severity: "P1"              # optional — P1/P2/P3/Critical
cover_image: /assets/img/covers/your-image.jpg   # optional
tags: [tag1, tag2]
excerpt: "Short description shown on homepage cards."
read_time: 5               # minutes
---

Your content here in Markdown.
```

## Cover Images

Drop images in `assets/img/covers/`. Recommended size: **1200×675px** (16:9).

They display grayscale on homepage cards, full color on hover.

## Local Preview (optional)

```bash
gem install bundler
bundle install
bundle exec jekyll serve
```

Then open http://localhost:4000
