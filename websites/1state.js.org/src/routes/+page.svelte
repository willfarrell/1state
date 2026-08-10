<script>
import Card from "@design-system/components/Card.svelte";
import Codeblock from "@design-system/components/Codeblock.svelte";
import H1 from "@design-system/components/Heading1.svelte";
import H2 from "@design-system/components/Heading2.svelte";
import H3 from "@design-system/components/Heading3.svelte";
import Icon from "@design-system/components/Icon.svelte";
import Image from "@design-system/components/Image.svelte";
import LayoutSlices from "@design-system/components/LayoutSlices.svelte";
import A from "@design-system/elements/a.svelte";
import Div from "@design-system/elements/div.svelte";
import Li from "@design-system/elements/li.svelte";
import P from "@design-system/elements/p.svelte";
import Section from "@design-system/elements/section.svelte";
import Span from "@design-system/elements/span.svelte";
import Ul from "@design-system/elements/ul.svelte";

const codeExample = `import { createMachine, assign } from '@1state/core'

const signup = {
  context: { email: null, password: null },
  initial: 'email',
  states: {
    email: {
      on: { answer: { target: 'email', actions: assign({ email: (_ctx, e) => e.value }) } },
      go: [{ target: 'password', cond: (ctx) => ctx.email !== null }],
    },
    password: {
      on: { answer: { target: 'password', actions: assign({ password: (_ctx, e) => e.value }) } },
      go: [{ target: 'done', cond: (ctx) => ctx.password !== null }],
    },
    done: { type: 'final' },
  },
}

const machine = createMachine(signup, { context: await load(accountId) })

await machine.start() // exactly where they left off`;
</script>

<svelte:head>
    <title>1state</title>
    <meta
        name="description"
        content="A small finite state machine for JavaScript, shaped after SCXML. For multi-step forms where the next question depends on the answers already given."
    />
</svelte:head>
<LayoutSlices>
    <Section class="slice hero vertical">
        <Div class="inline-center">
            <Image
                alt="1state logo"
                src="/img/1state-logo.svg"
                width="96"
                height="96"
                decoding="auto"
                fetchpriority="high"
                loading="eager"
            />
            <H1>&lt;1state&gt;</H1>

            <P
                >A small finite state machine for JavaScript, shaped after SCXML.
                For multi-step forms: flows where the next question depends on the
                answers already given, where the user leaves halfway through, and
                where the flow gains a step while they are away.</P
            >
            <Div role="group">
                <P>
                    <A href="/docs" class="button"
                        ><Span>Get started</Span>
                        <Icon src="/img/icons.svg#arrow-inline-end" /></A
                    ></P
                ></Div
            >
            <H2 class="visually-hidden">At a glance</H2>
            <Ul class="grid">
                <Li class="stat">
                    <H3
                        ><Icon src="/img/icons.svg#feather" />
                        <Span>Zero</Span></H3
                    >
                    <P>Dependencies in the engine</P>
                </Li>
                <Li class="stat">
                    <H3
                        ><Icon src="/img/icons.svg#list-check" />
                        <Span>100%</Span></H3
                    >
                    <P>Line, branch and function coverage</P>
                </Li>
                <Li class="stat">
                    <H3
                        ><Icon src="/img/icons.svg#diagram" />
                        <Span>SCXML</Span></H3
                    >
                    <P>The shape it follows</P>
                </Li>
            </Ul>
        </Div>
    </Section>
    <Section class="slice grid">
        <Div class="inline-center">
            <H2>One property, three features</H2>
        </Div>
        <Ul class="grid">
            <Li class="card feature">
                <H3>Position is derived</H3>
                <P
                    >Nothing anywhere records "the user is on step 3". The
                    position is a pure function of the answers, recomputed from
                    the initial state on every <code>start()</code>. Guards read
                    the data.</P
                >
            </Li>
            <Li class="card feature">
                <H3>Resume is free</H3>
                <P
                    >Load the row into <code>context</code>, start, land on the
                    first gap. No cursor to load, because there is no cursor to
                    store.</P
                >
            </Li>
            <Li class="card feature">
                <H3>No skip-ahead</H3>
                <P
                    >A later state is unreachable until its predecessors' guards
                    pass. There is nothing to forge in a URL, because the
                    position never comes from the URL.</P
                >
            </Li>
            <Li class="card feature">
                <H3>Forward migration</H3>
                <P
                    >Add a state and every already-"complete" record re-opens at
                    it. Turning on a policy that inserts a step is how you reach
                    users who finished last year.</P
                >
            </Li>
            <Li class="card feature">
                <H3>Composition by spread</H3>
                <P
                    >A section is a self-contained machine that ends in a
                    <code>final</code> state and names no successor.
                    <code>onFinal</code> chains sections, and it belongs to the
                    composing flow — so the same definition drives the wizard and
                    the settings page.</P
                >
            </Li>
            <Li class="card feature">
                <H3>URLs without a route table</H3>
                <P
                    >The node id is the URL path. <code>route(segments)</code>
                    gives a step page its redirect target and its Back link off
                    one replay of the trail.</P
                >
            </Li>
        </Ul>
    </Section>
    <Section class="slice vertical">
        <Div class="inline-center">
            <H2>Show me the code!</H2>
            <P>A two-question signup, resumed from a database row:</P>
        </Div>
        <Div class="inline-center">
            <Codeblock code={codeExample}>{codeExample}</Codeblock>
        </Div>
    </Section>
    <Section class="slice vertical">
        <Div class="inline-center">
            <H2>Packages</H2>
            <P>Three of them. No dependencies in the engine, ESM only, Node 20+.</P>
        </Div>
        <Ul class="grid">
            <Card class="package" id="core">
                <H3><A href="/docs/packages/core">core</A></H3>
                <P>The engine: <code>createMachine</code>, <code>assign</code>, <code>toPath</code>, <code>toValue</code>.</P>
            </Card>
            <Card class="package" id="validate">
                <H3><A href="/docs/packages/validate">validate</A></H3>
                <P>Static checks for a definition, plus the <code>1state-validate</code> CLI.</P>
            </Card>
            <Card class="package" id="mermaid">
                <H3><A href="/docs/packages/mermaid">mermaid</A></H3>
                <P>Render a definition as a diagram, plus the <code>1state-mermaid</code> CLI.</P>
            </Card>
        </Ul>
    </Section>
    <Section class="slice vertical">
        <Div class="inline-center">
            <H2>There is no persistence adapter</H2><P>
                Deliberately. There is no machine state to persist — the position
                is derived from the answers, and the answers are your row.
                Persist the row, which you were going to do anyway, and you are
                done.
            </P>
            <A href="/docs/concepts/persistence" class="button"
                ><Span>Why</Span>
                <Icon src="/img/icons.svg#arrow-inline-end" />
            </A>
        </Div>
    </Section>
    <Section class="slice vertical">
        <Div class="inline-center">
            <H2>Ready to get started?</H2><P>
                Install the engine and write your first flow.
            </P>
            <A href="/docs/quick-start" class="button"
                ><Span>Read the docs</Span>
                <Icon src="/img/icons.svg#arrow-inline-end" />
            </A>
        </Div>
    </Section>

    <Section class="slice vertical">
        <Div class="inline-center">
            <P>
                <A href="https://github.com/sponsors/willfarrell" class="button"
                    ><Icon src="/img/icons.svg#heart" /><Span
                        >Become a sponsor</Span
                    >
                </A></P
            >
        </Div>
    </Section>
</LayoutSlices>
