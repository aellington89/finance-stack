<!--
Template: Issue PR
Used for: the body of an "Issue #<n> - <name>" PR, including a part ("Issue #<n> - <name>: <part>") and a bundle ("Issue #<n>, #<m> - <summary>"); GitHub fills it in when the PR is opened
Written by: /implement, or you
Standard: https://github.com/aellington89/dev_process/blob/main/standards/pull-requests.md (check before pushing: node scripts/dev-process/check-pr.mjs --title "<title>" --body-file <file>)
Replace each <placeholder>. Keep every heading; write "None." or "n/a: <reason>" under one that doesn't apply.
-->

Closes #<n>

<!-- One line per issue in the title: "Closes #<n>" when this PR completes it, or "Part of #<n>" when it delivers one part of the issue's delivery plan.
     How many PRs: https://github.com/aellington89/dev_process/blob/main/standards/pull-requests.md#how-many-pull-requests -->

## Summary

<!-- What changed and why, in one to three sentences, and for a part, which part of the delivery plan it is. Link the issue's decisions rather than repeating the spec. -->

## Acceptance criteria

<!-- Every criterion this PR delivers, verbatim from the issue, ticked with its evidence (test name, screenshot, or manual check).
     A PR that closes an issue lists all of its criteria, with evidence from this PR or the issue's earlier parts; a bundle groups them by issue.
     A part that delivers none writes "None in this part: <why>".
     /verify fills this in using https://github.com/aellington89/dev_process/blob/main/templates/verification-report.md. -->

- [ ] <criterion>: <evidence>

## Test plan

- [ ] The verify command passes (the command is in CLAUDE.md, under Dev process)
- [ ] New or changed behavior has tests that fail without this change, or the reason it can't is written here
- [ ] The end-to-end tests pass, for changes to a user flow
- [ ] UI changes checked by hand: every theme, keyboard only, reduced motion, the smallest supported size

## Notes for reviewers

<!-- Decisions made while implementing, risks (data, platforms), and anything deferred, with its issue. Or "None." -->

## Checklist

- [ ] CHANGELOG.md entry under **Unreleased** for each issue this PR makes visible to users, in the section that describes it (Added, Changed, Fixed, …), starting **Breaking:** if users must act (skip for a part users can't notice yet, or a chore with no user impact)
- [ ] Docs that describe what changed are updated in this PR, such as the README
- [ ] Changes to stored data use a new numbered migration with a way back; released migrations are untouched
- [ ] New input from outside the trust boundary (user input, files, network, other processes) is validated
- [ ] The project's additions to the Definition of Done (docs/PROCESS.md) hold
- [ ] CLAUDE.md, an ADR, or the user guide updated if this sets a convention, makes a lasting decision, or changes what users see (`/retro`)

## Screenshots

<!-- UI changes only: before and after. -->
