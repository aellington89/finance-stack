<!--
Template: Issue PR
Used for: the body of an "Issue #<n> - <name>" PR; GitHub fills it in when the PR is opened
Written by: /implement, or you
Standard: https://github.com/aellington89/dev_process/blob/main/standards/pull-requests.md (check before pushing: node scripts/dev-process/check-pr.mjs --title "<title>" --body-file <file>)
Replace each <placeholder>. Keep every heading; write "None." or "n/a: <reason>" under one that doesn't apply.
-->

Closes #<n>

## Summary

<!-- What changed and why, in one to three sentences. Link the issue's decisions rather than repeating the spec. -->

## Acceptance criteria

<!-- Every criterion from the issue, verbatim, ticked with its evidence (test name, screenshot, or manual check).
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

- [ ] CHANGELOG.md entry under **Unreleased**, in the section that describes it (Added, Changed, Fixed, …), starting **Breaking:** if users must act (skip for chores with no user impact)
- [ ] Docs that describe what changed are updated in this PR, such as the README
- [ ] Changes to stored data use a new numbered migration with a way back; released migrations are untouched
- [ ] New input from outside the trust boundary (user input, files, network, other processes) is validated
- [ ] The project's additions to the Definition of Done (docs/PROCESS.md) hold
- [ ] CLAUDE.md, an ADR, or the user guide updated if this sets a convention, makes a lasting decision, or changes what users see (`/retro`)

## Screenshots

<!-- UI changes only: before and after. -->
