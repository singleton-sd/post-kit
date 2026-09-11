# Learnings — contact CORS, custom domain, agent handoff (2026-09)

Hard-won notes from the InkAds contact outage and `postkit.singletonsd.com`
work ([#145](https://github.com/singleton-sd/post-kit/issues/145),
[#146](https://github.com/singleton-sd/post-kit/issues/146)). Keep this short;
durable checklists live in
[`docs/onboarding/contact-consumer.md`](../onboarding/contact-consumer.md) and
the `postkit-contact-consumer` skill.

## Product / platform

1. **Dual CORS is mandatory on Linux Consumption.** The Functions host answers
   browser `OPTIONS` before worker code runs. App Config `app:email:origins`
   + `contactCorsHeaders` only affect requests that reach the function (e.g.
   `POST`). Platform CORS still needs **exact** `https://…` origins — no
   `*.poc…` globs. **Own the list in App Config** (`origins` exact hosts +
   `profilesByHost` keys) and run
   [`scripts/sync-function-cors-from-appconfig.sh`](../../scripts/sync-function-cors-from-appconfig.sh)
   (`pnpm cors:sync`, Deploy API). Do not maintain a parallel hardcoded list
   in bicep.
2. **Symptom split:** missing platform CORS → browser reports no
   `Access-Control-Allow-Origin` on preflight (often a bare `204`). Direct
   `POST` may still return app CORS headers.
3. **Contact HTTP 500 after CORS is fixed** often means Forward Email rejected
   the send (e.g. **400 Domain does not exist** for a new
   `mail.<consumer>…` from-address). Provision the domain before chasing App
   Config / Key Vault. See
   [`docs/email-forward-email.md`](../email-forward-email.md).
4. **Custom API hostname sequence that worked on Y1 Linux Consumption:**
   Route53 `asuid.<host>` TXT (verification id) → CNAME →
   `az functionapp config hostname add` →
   `az functionapp config ssl create` → wait until cert exists →
   `az functionapp config ssl bind --ssl-type SNI` → only then flip live
   `app:api:publicBaseUrl`. Keep `*.azurewebsites.net` as fallback.
5. **CLI noise:** managed-cert create may print a deserialization warning and
   still succeed; poll `az webapp config ssl show` until thumbprint appears.
   `az functionapp show` / bind responses may show `siteConfig.cors: null`
   even when CORS is still set — verify with `az functionapp cors show`.

## Agent / tooling

1. **Handoff = pushed PR + issue comment.** Live Azure/DNS fixes without a PR
   (or with only an uncommitted worktree) look like “nothing happened.” Finish
   with `Closes #N`, verification curls, and no secrets.
2. **Parallel agents need exclusive file ownership** (stated in the issue).
   `#145` owned DNS/hostname/`publicBaseUrl`; `#146` owned bicep CORS +
   contact delivery + skill/docs. Shared hubs without ownership collide.
3. **Route53:** prefer `~/.config/pc-provision/route53.zones.map` (e.g.
   `singletonsd.com=Z2PHDBJIVYBXRT`). The `resolve-route53-zone` shim may
   point at a missing `/mnt/c/…/pc-provision` path on WSL — do not block on
   that wrapper if the map + AWS creds from `company.secrets.env` work.
4. **WSL often lacks `dig` / `nslookup`.** Use `aws route53 …`, `getent
   hosts`, or `curl` for checks.
5. **Skills source of truth is `ai-plattform` skills (GitLab), not post-kit.**
   The GitHub `ai-plattform-skills` mirror may be archived/read-only. Open the
   skill MR on GitLab, then wire `pnpm sync:skills` in post-kit. Capture
   product ops rules in post-kit `docs/**`; capture reusable agent procedure
   in the skill.

## Related

| Artifact | Link |
| --- | --- |
| Custom domain PR | [#147](https://github.com/singleton-sd/post-kit/pull/147) |
| CORS / consumer docs PR | [#148](https://github.com/singleton-sd/post-kit/pull/148) |
| Contact consumer checklist | [`docs/onboarding/contact-consumer.md`](../onboarding/contact-consumer.md) |
| Skills MR | [ai-plattform/skills !13](https://gitlab.com/singleton-sd/ai-plattform/skills/-/merge_requests/13) |
