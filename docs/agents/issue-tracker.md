# Issue tracker: GitHub

Issues and specs live in natsusorahoshinochan-max/YesPlayMusic.
Use the gh CLI from this repo.

## Operations

- Create: gh issue create --title "..." --body-file <file>
- Read: gh issue view <number> --json number,title,body,labels,comments
- List: gh issue list --state open --json number,title,body,labels
- Comment: gh issue comment <number> --body-file <file>
- Apply labels: gh issue edit <number> --add-label "<label>"
- Remove labels: gh issue edit <number> --remove-label "<label>"
- Close: gh issue close <number> --comment "..."

Write multiline bodies to a temporary file and pass --body-file.
Infer the repository from the Git remote.

When a skill says "publish to the issue tracker", create a GitHub issue.
When it says "fetch the relevant ticket", read the GitHub issue.

## Pull requests as a triage surface

**PRs as a request surface: no.**

## Parent issues and dependencies

Use native GitHub sub-issues and issue dependencies where available.
Otherwise, put "Part of #<parent>" and "Blocked by: #<number>" at
the top of child issue bodies, and link children in the parent task list.

## Wayfinding

The map is one issue labelled wayfinder:map.
Link child tickets to it and label them wayfinder:<type>, where type is
research, prototype, grilling, or task.

Choose the first open child in map order with no open blockers or assignee.
Claim it by assigning yourself. After resolution, comment with the answer,
close the child, and append a brief finding and link to the map's
Decisions-so-far section.
