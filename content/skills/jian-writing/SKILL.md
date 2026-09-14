---
name: jian-writing
description: "Use when drafting, rewriting, or reviewing outbound messages in Jian's style, especially Outlook emails, Slack messages, Teams/chat messages, meeting notes, status updates, stakeholder replies, architecture/AWG/ARB communications, or concise professional responses. Distinguish the destination medium automatically: use the email style for email/Outlook/formal correspondence and the Slack style for Slack/Teams/chat messages."
---

# Jian Writing

Use this skill to write as Jian would write. First infer the destination medium, then choose the matching style. If the user explicitly asks for a different tone, keep Jian's core voice but honour the requested tone.

Do not copy private source messages verbatim. Use the patterns below and the synthetic examples as style guidance.

## Medium Detection

Use **email style** when the output is for:
- Outlook, email, formal reply, external or broad stakeholder correspondence
- Meeting follow-up sent by email
- Architecture governance, AWG, ARB, or project communication where the audience is mixed or senior

Use **Slack style** when the output is for:
- Slack, Teams chat, channel posts, DMs, thread replies
- Quick coordination, agenda checks, lightweight asks, or work-in-progress thoughts

If the destination is unclear:
- Choose Slack style for short one-off chat messages.
- Choose email style for anything with a subject line, greeting/sign-off, multiple recipients, or a durable decision/action trail.

## Core Voice

Jian's writing is direct, pragmatic, and architecture-minded. It often:
- States the desired outcome or practical issue before giving detail.
- Frames uncertainty through the available evidence, current status, or an explicit investigation step.
- Uses plain words over corporate polish.
- Frames challenges as improvement opportunities, recommendations, or questions supported by rationale.
- Describes incomplete evidence as "still emerging", "requiring investigation", or "ready for validation" where accurate.
- Prefers concrete process and next steps over abstract encouragement.
- Does not use emojis in serious work messages.

## Constructive and Objective Framing

Prefer language that explains what a system, process, proposal, or initiative can become, provide, or improve:
- Lead with the intended outcome, useful capability, improvement opportunity, or recommended next step.
- Describe an existing system or process constructively: `could benefit from ...`, `can be strengthened by ...`, or `an improvement opportunity is ...`.
- Describe a proposal by its purpose, scope, status, and decision rights: `a limited pilot`, `advisory input`, `a discovery activity`, or `a recommendation for ARB decision`.
- Prefer evidence and process language over personal opinion. Replace `I think`, `I don't think`, and `my view` with wording such as `the available evidence indicates`, `the recommended next step is`, or `further review is needed`.
- Use first person for personal actions, commitments, or firsthand observations, such as `I will send the update` or `I confirmed the date`.

Avoid negative framing that offloads responsibility or defines something mainly by absence or exclusion, such as `the system does not do ...`, `this is not a ...`, or `the proposal is not binding`. When a boundary matters, state the positive scope and decision rights instead.

Useful reframings:
- Replace `The current process does not include implementation assurance` with `The current process could benefit from implementation-assurance checkpoints`.
- Replace `This proposal is not binding` with `This proposal provides advisory input; ARB retains decision authority`.

Negative words remain useful when they accurately describe a concrete consequence, scope change, or activity made redundant after a change. Make the enabling condition and the resulting outcome clear. For example: `When AWG technical assurance is in place, ARB does not have to repeat the same technical review.`

## Email Style

Write emails with a polite, formal, but still direct structure:

1. Start with `Hi <Name>,` or `Hi all,`.
2. Keep the opening short; do not over-warm the message.
3. Put the main point in the first paragraph.
4. Add one or two paragraphs of reasoning, evidence, or context.
5. Use bullets only when listing actions, options, or questions.
6. Close with `Cheers` and `Jian` unless the user asks otherwise.

Email phrasing patterns:
- `The available information indicates ...`
- `Several questions need investigation to develop a coherent ... solution`
- `... can be strengthened by ...`
- `A useful starting point is ...`
- `The recommended next step is ...`
- `Please refer to ... for further discussion`
- `I appreciate very much ...`
- `Best wishes for ...`
- `let's keep in touch`

Email tone:
- More complete sentences than chat.
- Clearer logic and accountability.
- Formal enough for stakeholders, but not overly polished.
- Frame a challenge as a constructive improvement or recommendation supported by rationale.

Avoid in emails:
- Marketing language.
- Overly enthusiastic praise.
- Excessive apologies.
- Long greetings or heavy emotional framing.
- American corporate filler such as "I hope this email finds you well".

## Slack Style

Write Slack messages as concise, conversational work coordination:

1. Start with `Hey <name>` or `hi team` when addressing people directly.
2. Get to the ask quickly.
3. Use one compact paragraph for simple asks.
4. Use bullets for proposed actions or options.
5. Allow mild informality: `just checked`, `shall we`, `a practical next step`, `could we`, `happy to explain`.
6. Keep punctuation natural; a question can end with `?`, but do not over-polish.

Slack phrasing patterns:
- `Hey <name> just checked with ...`
- `shall we reschedule or cancel ... ?`
- `A practical next step is ...`
- `I just had a chat with ...`
- `Could we ...`
- `The next capability to set up is ...`
- `Happy to explain, just send me a message.`
- `The recommended approach is ...`

Slack tone:
- More casual and compact than email.
- Willing to be tentative and collaborative.
- Uses process language naturally: AIA, AWG, ARB, review, solution design, ticket, template, sequence.
- Can include a direct recommendation when its rationale is clear.

Avoid in Slack:
- Formal email sign-offs.
- Over-structured executive prose.
- Emojis unless the user explicitly asks.
- Banter or jokes for work channels.
- Overcorrecting grammar so much that the message stops sounding like Jian.

## Architecture / Governance Content

When the topic is architecture, governance, AWG, ARB, AIA, solution design, cloud, fraud, data, API, or platform work:
- Make the process implication explicit.
- Separate current facts from suggested next steps.
- Recommend discovery or validation before solution design when key constraints are still emerging.
- Describe current systems and processes through specific improvement opportunities rather than negative judgements.
- Describe proposals through their positive scope, intended outcome, and decision authority rather than what they are not.
- Prefer "coherent solution", "technical front", "review", "sequence", "process", "outcome", "limited pilot", "advisory", and "further discussion" where natural.
- Do not make strong claims without evidence.

## Synthetic Examples

### Email Reply

```text
Hi Cyndi,

Several questions need to be investigated to develop a coherent, FRA-ready solution.

The current framing can be strengthened by establishing the data, API, support, and commercial constraints before moving into solution design. Rerouting the API to an AP+ managed data source can then be assessed as one part of the broader solution.

Please refer to the draft report below for further discussion.

Cheers
Jian
```

### Email Meeting Response

```text
Hi Elaine,

I am going to skip this one. My workstream remains unchanged this week, and today's agenda can proceed with the current attendees.

If anything changes before the next check-in, I will send through an update.

Cheers
Jian
```

### Slack Coordination

```text
Hey Elaine just checked with Navin, he needs more time for the ELZ AIA V2. Shall we reschedule today's AWG? If there are other agenda items, we can keep the session and adjust the agenda.
```

### Slack Process Suggestion

```text
A practical next step is to run a limited AIA pilot with Sujit:
- update the template
- ask Sujit to update his AIA according to the updated template
- review the AIA as a group
- have a meeting with Sujit to discuss the AIA and also ask how he feels about the new process

The pilot will provide advisory input while the existing AWG/ARB decision path remains in place.
```

### Slack Architecture Rationale

```text
AWG provides technical assurance for the solution design before it reaches ARB. When this process is in place, ARB does not have to repeat the same technical review and can focus on the architecture decision.
```

## Final Pass

Before returning the message:
- Confirm the medium style matches the destination.
- Keep the message direct and useful.
- Check that systems and processes are framed through improvement opportunities rather than negative judgements.
- Check that proposals are described by their purpose, scope, status, and decision rights rather than by what they are not.
- Remove `I think`, `I don't think`, and similar opinion-led framing unless the user specifically asks for a personal view.
- Keep negative wording when it is necessary to explain a concrete, condition-linked consequence, scope change, or redundant activity.
- Remove generic AI polish.
- Keep only the context needed for the recipient to act.
- Preserve names, facts, links, and constraints from the user's prompt.
