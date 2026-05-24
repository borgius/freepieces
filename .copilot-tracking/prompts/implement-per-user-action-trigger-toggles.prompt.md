---
description: 'Implement the tracked per-user action and trigger toggle feature from the validated plan.'
mode: agent
model: Claude Sonnet 4
---

<!-- markdownlint-disable-file -->

# Implementation Prompt: Per-User Action/Trigger Toggles

## Implementation Instructions

### Step 1: Create Changes Tracking File

You WILL create `20260522-per-user-action-trigger-toggles-changes.md` in #file:../changes/ if it does not exist.

### Step 2: Execute Implementation

You WILL follow #file:../../AGENTS.md
You WILL systematically implement #file:../plans/20260522-per-user-action-trigger-toggles-plan.instructions.md task-by-task
You WILL use #file:../details/20260522-per-user-action-trigger-toggles-details.md for the exact file operations, dependencies, and validation targets
You WILL use #file:../research/20260522-per-user-action-trigger-toggles-research.md as the evidence base for scope decisions and behavior details

**CRITICAL**: No repository-local `.github/instructions/task-implementation.instructions.md` file exists in this workspace, so `AGENTS.md`, the tracked plan, the details file, and the research file are the implementation source of truth.
**CRITICAL**: If ${input:phaseStop:true} is true, you WILL stop after each Phase for user review.
**CRITICAL**: If ${input:taskStop:false} is true, you WILL stop after each Task for user review.

### Step 3: Cleanup

When ALL Phases are checked off (`[x]`) and completed you WILL do the following:

1. You WILL provide a markdown style link and a brief summary of all changes from #file:../changes/20260522-per-user-action-trigger-toggles-changes.md to the user.

2. You WILL provide markdown style links to #file:../plans/20260522-per-user-action-trigger-toggles-plan.instructions.md, #file:../details/20260522-per-user-action-trigger-toggles-details.md, and #file:../research/20260522-per-user-action-trigger-toggles-research.md. You WILL recommend cleaning these files up as well.

3. **MANDATORY**: You WILL attempt to delete #file:../prompts/implement-per-user-action-trigger-toggles.prompt.md.

## Success Criteria

- [ ] Changes tracking file created
- [ ] All plan items implemented with working code
- [ ] All detail-file requirements satisfied
- [ ] Worker/runtime, admin UI, docs, and tests kept in sync per `AGENTS.md`
- [ ] Validation completed with `npm test`, `npm run check`, and `npm run build`
