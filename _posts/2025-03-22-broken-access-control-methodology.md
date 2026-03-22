---
layout: post
title: "Broken Access Control — My Hunting Methodology"
date: 2025-03-22
category: "Bug Bounty"
severity: "P1"
cover_image: /assets/img/covers/bac-cover.jpg
tags: [BAC, IDOR, methodology, access-control]
excerpt: "How I map, enumerate, and exploit Broken Access Control across modern web apps — from IDOR chains to privilege escalation."
read_time: 8
---

Broken Access Control is consistently the #1 finding on HackerOne. Most hunters find the obvious IDORs. This is about finding the ones they miss.

## Attack Surface Mapping

Start with feature-based mapping, not URL crawling. Every feature that touches a resource owned by a user is a candidate.

- Object references in URL params, body, headers, cookies
- Indirect references — slugs, hashes, UUIDs that resolve to sequential IDs server-side
- Role-based endpoints hidden behind the UI
- API versioning — `/v1/` endpoint may lack controls added in `/v2/`

## The Two-Account Setup

Always test with two accounts in the same role before testing cross-role.

```
Account A → performs action → captures request
Account B → replays that request → observe response
```

A `200 OK` with Account B's session accessing Account A's resource = confirmed BAC. Don't stop there.

## What Most Hunters Miss

**State-based access control** — the check happens at creation, not at access time. Resource is locked initially but becomes accessible after a state transition the attacker can trigger independently.

**Batch endpoints** — `POST /api/messages/batch` accepts an array of IDs. Single-object endpoint validates ownership. Batch endpoint skips the check.

**Export/report features** — `/export?report_id=123` bypasses the per-object ACL because the export layer was built by a different team.

## Chaining for Critical Impact

Single BAC finding → P3. Chain it:

1. IDOR on `/api/users/{id}` leaks PII → P2
2. Same IDOR allows email update → account takeover → P1
3. Account takeover on admin user → full compromise → Critical

Always ask: what's the most privileged action this object access enables?
