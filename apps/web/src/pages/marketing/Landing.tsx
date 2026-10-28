import { useEffect } from 'react';
import { useLocation } from 'react-router-dom';
import {
  Activity,
  ArrowRight,
  Bell,
  Building2,
  Check,
  Clock3,
  CirclePlay,
  Eye,
  FileText,
  Info,
  Link2,
  MessageCircleQuestion,
  Monitor,
  Search,
  Server,
  Shield,
  ShieldCheck,
  TriangleAlert,
  Zap,
} from 'lucide-react';
import { Reveal } from '../../components/Reveal';
import { SiteHeader } from '../../components/marketing/SiteHeader';
import { SiteFooter } from '../../components/marketing/SiteFooter';
import { ButtonLink, Container, TextLink } from '../../components/marketing/ui';
import { usePageMeta } from '../../lib/usePageMeta';

const CAPABILITIES = [
  {
    index: '01',
    icon: Monitor,
    iconTone: 'bg-[#eaf3ff] text-[#3180f7]',
    checkTone: 'bg-[#eaf3ff] text-[#4180f8]',
    title: 'Automatic monitoring',
    body: 'Add a URL once. BreakGlass schedules the checks itself on a durable queue, with retries and run locks so a slow check never runs twice at the same time.',
    points: ['Checks run from our workers, not your browser', 'Runs continue while you are signed out', 'Every run is stored, not just the latest'],
  },
  {
    index: '02',
    icon: TriangleAlert,
    iconTone: 'bg-[#eaf3ff] text-[#20b885]',
    checkTone: 'bg-[#eaf3ff] text-[#20b885]',
    title: 'Catch failures earlier',
    body: 'A single failed request is not an outage. Each check has a failure threshold, so BreakGlass opens one incident when the problem is confirmed — and keeps the runs that led up to it.',
    points: ['Configurable failure and recovery thresholds', 'One incident per ongoing problem', 'Alert deduplication per destination'],
  },
  {
    index: '03',
    icon: Search,
    iconTone: 'bg-[#eaf3ff] text-[#6849f5]',
    checkTone: 'bg-[#eaf3ff] text-[#6849f5]',
    title: 'Investigate with evidence',
    body: 'Every run keeps what it observed: status code, duration, failure category, a bounded body preview, and for browser journeys a screenshot of the page at the failing step.',
    points: ['Failure screenshots stored privately', 'Signed, expiring URLs for evidence', 'Deployments listed as timing context only'],
  },
];

const STEPS = [
  {
    index: '01',
    title: 'Add the site',
    body: 'Give BreakGlass the client’s URL and a name. Then choose what to check: uptime, an API endpoint with JSON assertions, or a browser journey through a real workflow.',
  },
  {
    index: '02',
    title: 'Test the check (recommended)',
    body: 'Run a configuration test to see the live response, status code, duration and any assertion failure. Testing is optional: you can save a draft or activate the check without running a test first.',
  },
  {
    index: '03',
    title: 'Activate and leave it',
    body: 'Activation schedules checks on the running worker, even when you are signed out. Configure email or Slack destinations in Settings to receive incident and recovery alerts. Without a live email provider, email is saved to the development outbox instead of a real inbox.',
  },
];

const AGENCY_POINTS = [
  'One workspace holds every client site, with the client name kept on each project.',
  'The overview answers the only question that matters at 9am: is anything broken right now?',
  'Evidence is readable by someone who is not in the dashboard — forward the incident instead of describing it.',
  'Incidents deduplicate per check, so a site that fails all day is one problem, not four hundred alerts.',
];

function Hero() {
  return (
    <section className="relative isolate min-h-[100svh] overflow-hidden bg-[#f7faff] pt-[76px] sm:pt-[88px]">
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 -z-10 bg-cover bg-[center_58%] bg-no-repeat"
        style={{ backgroundImage: "url('/images/landing-himalaya.webp')" }}
      />
      <Container className="flex flex-col items-center pb-16 pt-10 text-center sm:pb-24 sm:pt-11">
        <p className="animate-fade-up inline-flex items-center gap-2 rounded-full border border-[#dbe6ff] bg-white/75 px-4 py-2 text-[10px] font-semibold uppercase tracking-[0.16em] text-[#5279ed] shadow-sm backdrop-blur-sm sm:text-[11px]">
          <span className="flex h-7 w-7 items-center justify-center rounded-full bg-[#eaf3ff]">
            <ShieldCheck className="h-4 w-4" aria-hidden />
          </span>
          Website monitoring system
        </p>
        <h1 className="mt-7 max-w-[900px] animate-fade-up text-balance text-[clamp(2.15rem,4.7vw,3.8rem)] font-semibold leading-[1.08] tracking-[-0.045em] text-[#263953] [animation-delay:60ms] sm:mt-8">
          Know When Your
          <br className="hidden sm:block" /> Clients&rsquo; Websites Break.
          <span className="block text-[#5880f5]">Before They Do.</span>
        </h1>
        <p className="mt-6 max-w-[560px] animate-fade-up text-[14px] leading-[1.7] text-[#71819d] [animation-delay:120ms] sm:mt-7 sm:text-[16px]">
          Stay ahead with real-time website monitoring, instant alerts, and uptime insights — so you can keep your clients&rsquo; online presence running smoothly.
        </p>
        <div className="mt-7 flex w-full animate-fade-up flex-col justify-center gap-3 [animation-delay:180ms] sm:mt-8 sm:w-auto sm:flex-row sm:gap-5">
          <ButtonLink
            to="/signup"
            variant="primary"
            size="lg"
            withArrow
            className="h-[50px] rounded-full bg-[#3154f5] px-7 shadow-[0_8px_20px_-8px_rgba(49,84,245,0.65)] hover:bg-[#2545e8] sm:px-8"
          >
            Start Monitoring
          </ButtonLink>
          <a
            href="#how-it-works"
            className="inline-flex h-[50px] items-center justify-center gap-2.5 rounded-full border border-[#dce3ee] bg-white/65 px-7 text-[13px] font-semibold text-[#354760] shadow-sm backdrop-blur-sm transition-colors hover:border-[#afc1e0] hover:bg-white sm:px-8"
          >
            <span className="flex h-7 w-7 items-center justify-center rounded-full bg-[#eaf3ff]">
              <CirclePlay className="h-[18px] w-[18px] text-[#405a7d]" aria-hidden />
            </span>
            See How It Works
          </a>
        </div>
        <div className="mt-11 grid w-full max-w-[640px] animate-fade-up grid-cols-1 divide-y divide-[#cdd7e8]/70 [animation-delay:240ms] sm:mt-14 sm:grid-cols-3 sm:divide-x sm:divide-y-0">
          {[
            { icon: Zap, title: 'Real-time alerts', detail: 'Get notified instantly' },
            { icon: ShieldCheck, title: 'Uptime tracking', detail: 'Keep sites online' },
            { icon: Activity, title: 'Actionable insights', detail: 'Make better decisions' },
          ].map(({ icon: Icon, title, detail }) => (
            <div key={title} className="flex items-center justify-center gap-3 px-3 py-3.5 text-left sm:justify-start sm:px-5 sm:py-1 first:sm:pl-0 last:sm:pr-0">
              <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-[#eaf3ff]">
                <Icon className="h-5 w-5 text-[#6590ff]" strokeWidth={2.2} aria-hidden />
              </span>
              <div>
                <p className="text-[11px] font-semibold text-[#33445f] sm:text-[11.5px]">{title}</p>
                <p className="mt-0.5 text-[10px] text-[#8290a6]">{detail}</p>
              </div>
            </div>
          ))}
        </div>
      </Container>
    </section>
  );
}

function ProductSection() {
  return (
    <section
      id="product"
      aria-labelledby="product-heading"
      className="relative isolate scroll-mt-20 overflow-hidden bg-[#fbfcff] py-8 sm:py-10 lg:py-12"
    >
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 -z-20 scale-x-[-1] bg-cover bg-[center_66%] bg-no-repeat"
        style={{ backgroundImage: "url('/images/landing-himalaya.webp')" }}
      />
      <div aria-hidden="true" className="pointer-events-none absolute inset-0 -z-10 bg-white/70" />

      <div className="mx-auto w-full max-w-[1500px] px-5 sm:px-8 lg:px-10">
        <Reveal>
          <div className="mx-auto max-w-[760px] text-center">
            <h2
              id="product-heading"
              className="text-balance text-[clamp(2rem,4vw,3rem)] font-semibold leading-[1.1] tracking-[-0.035em] text-[#20324e]"
            >
              Three Things a Ping
              <span className="block text-[#4779f5]">Cannot Do.</span>
            </h2>
            <p className="mx-auto mt-5 max-w-[700px] text-[13px] leading-[1.8] text-[#7787a2] sm:text-[14px]">
              Uptime is one number. It cannot tell you that the checkout button stopped submitting,
              that an API started returning an empty list, or that a font change broke the layout on
              mobile. BreakGlass checks the things that actually break.
            </p>
          </div>
        </Reveal>

        <div className="mt-8 grid grid-cols-1 gap-5 sm:mt-10 sm:gap-6 lg:grid-cols-3 lg:gap-8">
          {CAPABILITIES.map((capability, index) => {
            const Icon = capability.icon;

            return (
            <Reveal key={capability.index} delay={index * 80} className="h-full">
              <article className="flex h-full min-h-[370px] flex-col rounded-[18px] border border-white/90 bg-white/90 p-6 shadow-[0_12px_36px_-24px_rgba(47,73,125,0.28)] backdrop-blur-sm sm:p-7 lg:p-8">
                <div className="flex items-center gap-7">
                  <span className={`flex h-[60px] w-[60px] shrink-0 items-center justify-center rounded-[17px] ${capability.iconTone}`}>
                    <Icon className="h-[29px] w-[29px]" strokeWidth={2} aria-hidden />
                  </span>
                  <div className="flex items-center gap-4">
                    <span className="tabular text-[18px] font-semibold text-[#bdcbed]">{capability.index}</span>
                    <span className="h-px w-9 bg-[#e1e9fa]" aria-hidden />
                  </div>
                </div>
                <h3 className="mt-4 text-[17px] font-semibold tracking-[-0.02em] text-[#263751] sm:text-[18px]">
                  {capability.title}
                </h3>
                <p className="mt-2.5 text-[12px] leading-[1.75] text-[#7888a3] sm:text-[13px]">{capability.body}</p>
                <ul className="mt-5 space-y-2.5 border-t border-[#e6edf7] pt-4 sm:mt-5">
                  {capability.points.map((point) => (
                    <li key={point} className="flex items-center gap-3 text-[11.5px] leading-snug text-[#637691] sm:text-[12px]">
                      <span className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full ${capability.checkTone}`}>
                        <Check className="h-3.5 w-3.5" strokeWidth={2.5} aria-hidden />
                      </span>
                      <span>{point}</span>
                    </li>
                  ))}
                </ul>
              </article>
            </Reveal>
            );
          })}
        </div>
      </div>
    </section>
  );
}

function HowItWorksSection() {
  return (
    <section
      id="how-it-works"
      aria-labelledby="how-heading"
      className="relative isolate scroll-mt-20 overflow-hidden bg-[#fbfcff] pb-8 pt-12 sm:pb-10 sm:pt-14 lg:pb-12 lg:pt-16"
    >
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 -z-20 scale-x-[-1] bg-cover bg-[center_66%] bg-no-repeat"
        style={{ backgroundImage: "url('/images/landing-himalaya.webp')" }}
      />
      <div aria-hidden="true" className="pointer-events-none absolute inset-0 -z-10 bg-white/70" />

      <div className="mx-auto w-full max-w-[1500px] px-5 sm:px-8 lg:px-10">
        <Reveal>
          <div className="mx-auto max-w-3xl text-center">
            <h2
              id="how-heading"
              className="text-balance text-[clamp(2rem,4vw,3rem)] font-semibold leading-[1.1] tracking-[-0.035em] text-[#20324e]"
            >
              Three Steps, Then It Runs
              <span className="block text-[#4779f5]">Without You.</span>
            </h2>
            <p className="mx-auto mt-5 max-w-[680px] text-[14px] leading-[1.8] text-[#7787a2] sm:text-[15px]">
              Setup takes a few minutes per site. After that, monitoring is a background process
              on our infrastructure — not a tab you have to keep open.
            </p>
          </div>
        </Reveal>

        <ol className="mt-10 grid grid-cols-1 gap-8 sm:mt-12 lg:grid-cols-3 lg:gap-12">
          {STEPS.map((step, index) => {
            const Icon = [Link2, Shield, Bell][index];
            const iconColors = [
              'bg-[#eaf3ff] text-[#4779f5]',
              'bg-[#eaf3ff] text-[#159879]',
              'bg-[#eaf3ff] text-[#6849f5]',
            ][index];

            return (
              <Reveal key={step.index} delay={index * 80} className="h-full">
                <li className="relative flex h-full min-h-[220px] gap-6 rounded-[18px] border border-white/80 bg-white/85 p-6 shadow-[0_12px_36px_-28px_rgba(54,77,122,0.3)] backdrop-blur-sm sm:p-7 lg:p-8">
                  <span className={`flex h-[64px] w-[64px] shrink-0 items-center justify-center rounded-full ${iconColors}`}>
                    <Icon className="h-[26px] w-[26px]" strokeWidth={2} aria-hidden />
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-3">
                      <span className="tabular text-[18px] font-semibold leading-none text-[#b3c5ff]">{step.index}</span>
                      <span className="h-px w-9 bg-[#e1e9fa]" aria-hidden />
                    </div>
                    <h3 className="mt-5 text-[16px] font-semibold tracking-[-0.01em] text-[#263751] sm:text-[17px]">
                      {step.title}
                    </h3>
                    <p className="mt-3 text-[12px] leading-[1.8] text-[#7888a3] sm:text-[13px]">{step.body}</p>
                  </div>
                  {index < STEPS.length - 1 ? (
                    <span
                      className="absolute bottom-[-38px] left-1/2 z-10 flex h-9 w-9 -translate-x-1/2 items-center justify-center rounded-full border border-[#e4ebff] bg-white/90 text-[#7394fa] shadow-sm sm:bottom-[-38px] lg:bottom-auto lg:left-auto lg:right-[-42px] lg:top-1/2 lg:translate-x-0 lg:-translate-y-1/2"
                      aria-hidden="true"
                    >
                      <ArrowRight className="h-[18px] w-[18px] rotate-90 lg:rotate-0" />
                    </span>
                  ) : null}
                </li>
              </Reveal>
            );
          })}
        </ol>

        <Reveal delay={120}>
          <div className="relative mt-12 flex flex-col gap-5 overflow-hidden rounded-[18px] border border-[#e0ebff] bg-[#f3f8ff]/90 p-6 shadow-[0_12px_32px_-24px_rgba(54,100,190,0.35)] backdrop-blur-sm sm:mt-8 sm:flex-row sm:items-center sm:gap-8 sm:px-8 sm:py-6 lg:mt-7 lg:px-10">
            <div aria-hidden="true" className="pointer-events-none absolute inset-0 -z-10 bg-gradient-to-r from-white/35 via-transparent to-[#e6f0ff]/65" />
            <span className="absolute left-7 top-7 h-2.5 w-2.5 rounded-full bg-[#1fc48b] sm:left-10 sm:top-8" aria-hidden="true" />
            <span className="ml-1 flex h-[64px] w-[64px] shrink-0 items-center justify-center rounded-full bg-[#eaf3ff] text-[#299d83] sm:ml-0">
              <Server className="h-7 w-7" strokeWidth={1.8} aria-hidden />
            </span>
            <div className="min-w-0 flex-1">
              <h3 className="text-[14px] font-semibold text-[#263751] sm:text-[16px]">
                Monitoring is server-side, so logging out stops nothing.
              </h3>
              <p className="mt-1.5 max-w-[780px] text-[12px] leading-[1.8] text-[#7888a3] sm:text-[13px]">
                The dashboard is a view onto stored runs. Close the laptop, sign out, go to a client meeting —
                the scheduler keeps queueing checks and the worker keeps executing them.
              </p>
            </div>
            <ButtonLink
              to="/signup"
              variant="ghost"
              size="md"
              withArrow
              className="shrink-0 self-start rounded-full px-3 text-[13px] text-[#4779f5] hover:bg-white/70 hover:text-[#3154f5] sm:self-center"
            >
              Start Monitoring
            </ButtonLink>
          </div>
        </Reveal>
      </div>
    </section>
  );
}

function AgenciesSection() {
  const pointIcons = [Building2, MessageCircleQuestion, Eye, TriangleAlert];
  const pointTones = [
    { number: 'bg-[#eaf3ff] text-black', icon: 'bg-[#eaf3ff] text-[#3980fb]' },
    { number: 'bg-[#eaf3ff] text-black', icon: 'bg-[#eaf3ff] text-[#7055ee]' },
    { number: 'bg-[#eaf3ff] text-black', icon: 'bg-[#eaf3ff] text-[#35bd89]' },
    { number: 'bg-[#eaf3ff] text-black', icon: 'bg-[#eaf3ff] text-[#ef9a2c]' },
  ];

  return (
    <section
      id="for-agencies"
      aria-labelledby="agencies-heading"
      className="relative isolate scroll-mt-20 overflow-hidden bg-[#fbfcff] pb-12 pt-5 sm:pb-14 sm:pt-6 lg:pb-16 lg:pt-7"
    >
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 -z-20 bg-cover bg-[center_66%] bg-no-repeat"
        style={{ backgroundImage: "url('/images/landing-himalaya.webp')" }}
      />
      <div aria-hidden="true" className="pointer-events-none absolute inset-0 -z-10 bg-white/70" />

      <div className="mx-auto w-full max-w-[1320px] px-5 sm:px-8 lg:px-10">
        <img
          src="/images/correlation-rule-banner.png"
          alt="The rule in short: a deployment near an incident is timing correlation, not proof of cause. Not every coincidence is a cause."
          width={1068}
          height={156}
          loading="lazy"
          decoding="async"
          className="mx-auto mb-6 block h-auto w-full max-w-[1068px] sm:mb-8"
        />
        <div className="grid grid-cols-1 items-center gap-8 lg:grid-cols-[minmax(0,0.82fr)_minmax(0,1.18fr)] lg:gap-16">
          <Reveal>
            <div className="max-w-[510px]">
              <h2
                id="agencies-heading"
                className="text-[clamp(2rem,4vw,3.2rem)] font-semibold leading-[1.08] tracking-[-0.04em] text-[#263b5b]"
              >
                Built for the Person
                <span className="block text-[#3680f8]">Who Gets the Call.</span>
              </h2>
              <div className="mt-5 space-y-3 text-[13px] leading-[1.85] text-[#71839e] sm:text-[14px]">
                <p>
                  Agencies do not need another dashboard of green ticks. They need to know which client
                  is affected, what specifically stopped working, and enough evidence to explain it
                  without guessing.
                </p>
                <p>
                  BreakGlass is organised around that: projects hold client sites, incidents hold the
                  problem, and runs hold the proof.
                </p>
              </div>
              <ButtonLink
                to="/signup"
                variant="primary"
                size="md"
                withArrow
                className="mt-6 h-[44px] rounded-full bg-[#2875f5] px-6 text-[12px] shadow-[0_8px_20px_-9px_rgba(40,117,245,0.7)] hover:bg-[#1d65e5]"
              >
                Create a workspace
              </ButtonLink>
            </div>
          </Reveal>

          <div>
            <Reveal delay={100}>
              <div className="space-y-2.5 sm:space-y-3">
                {AGENCY_POINTS.map((point, index) => {
                  const Icon = pointIcons[index];
                  const tone = pointTones[index];

                  return (
                    <article
                      key={point}
                      className="group flex min-h-[88px] items-center gap-3 rounded-[16px] border border-white/90 bg-white/85 px-3.5 py-4 shadow-[0_10px_30px_-24px_rgba(47,73,125,0.32)] backdrop-blur-sm transition-transform duration-200 hover:-translate-y-0.5 sm:min-h-[100px] sm:gap-4 sm:px-4"
                    >
                      <span className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-[11px] font-semibold ${tone.number}`}>
                        0{index + 1}
                      </span>
                      <span className={`flex h-[54px] w-[54px] shrink-0 items-center justify-center rounded-[17px] sm:h-[58px] sm:w-[58px] ${tone.icon}`}>
                        <Icon className="h-[25px] w-[25px]" strokeWidth={2} aria-hidden />
                      </span>
                      <p className="min-w-0 flex-1 text-[12px] font-medium leading-[1.65] text-[#405573] sm:text-[13px]">
                        {point}
                      </p>
                      <ArrowRight className="h-[17px] w-[17px] shrink-0 text-[#83b1ff] transition-transform group-hover:translate-x-1" aria-hidden />
                    </article>
                  );
                })}
              </div>
            </Reveal>
            <div className="mt-4 flex items-center gap-4 rounded-[16px] border border-white/60 bg-white/45 px-5 py-4 backdrop-blur-sm sm:mt-5 sm:px-6">
              <Info className="h-[23px] w-[23px] shrink-0 rounded-full bg-[#eaf3ff] p-1 text-[#65a4f5]" aria-hidden />
              <span className="h-8 w-px shrink-0 bg-[#dce7f6]" aria-hidden />
              <p className="text-[10px] leading-[1.65] text-[#8697b0] sm:text-[11px]">
                No customer logos, testimonials or usage statistics appear on this page — this is a new
                product, and inventing them would tell you nothing about whether it works.
              </p>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

function FinalCta() {
  return (
    <section
      aria-labelledby="cta-heading"
      className="relative isolate overflow-hidden bg-[#f7faff] py-12 sm:py-16 lg:py-20"
    >
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 -z-20 scale-x-[-1] bg-cover bg-[center_66%] bg-no-repeat"
        style={{ backgroundImage: "url('/images/landing-himalaya.webp')" }}
      />
      <div aria-hidden="true" className="pointer-events-none absolute inset-0 -z-10 bg-white/65" />

      <Container>
        <div className="grid grid-cols-1 items-center gap-8 lg:grid-cols-[minmax(0,1.15fr)_minmax(360px,0.85fr)] lg:gap-14">
          <div>
            <Reveal>
              <h2
                id="cta-heading"
                className="max-w-[640px] text-[clamp(2.35rem,5vw,4rem)] font-semibold leading-[0.99] tracking-[-0.045em] text-[#182b4b]"
              >
                Your Clients&rsquo; Websites
                <span className="block text-[#4779f5]">Deserve a Second Set</span>
                <span className="block text-[#4779f5]">of Eyes.</span>
              </h2>
              <p className="mt-5 max-w-[510px] text-[13px] leading-[1.75] text-[#70819d] sm:text-[14px]">
                Set up monitoring once, then stop wondering whether a site is up. BreakGlass keeps
                checking, keeps the evidence, and tells you the moment something needs you.
              </p>
            </Reveal>

            <Reveal delay={100}>
              <div className="mt-6 grid max-w-[600px] grid-cols-1 divide-y divide-[#cdd9ed]/70 border-t border-[#cdd9ed]/70 sm:grid-cols-3 sm:divide-x sm:divide-y-0">
                {[
                  { icon: Clock3, title: '24/7 Monitoring', detail: 'Always on, always watching.' },
                  { icon: ShieldCheck, title: 'Instant Alerts', detail: 'Know before it’s too late.' },
                  { icon: FileText, title: 'Full Evidence', detail: 'Logs, screenshots, reports.' },
                ].map(({ icon: Icon, title, detail }) => (
                  <div key={title} className="flex items-center gap-3 py-3.5 sm:px-4 sm:first:pl-0 sm:last:pr-0">
                    <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-[#eaf3ff] text-[#548bfa] shadow-sm">
                      <Icon className="h-[19px] w-[19px]" strokeWidth={2} aria-hidden />
                    </span>
                    <div className="min-w-0">
                      <p className="text-[10px] font-semibold text-[#354964] sm:text-[10.5px]">{title}</p>
                      <p className="mt-1 text-[9px] leading-snug text-[#8493aa] sm:text-[9.5px]">{detail}</p>
                    </div>
                  </div>
                ))}
              </div>
            </Reveal>
          </div>

          <Reveal delay={120}>
            <div className="rounded-[18px] border border-white/90 bg-white/85 p-5 shadow-[0_16px_44px_-28px_rgba(47,73,125,0.35)] backdrop-blur-md sm:p-7">
              <div className="flex items-center gap-4 sm:gap-5">
                <span className="flex h-[60px] w-[60px] shrink-0 items-center justify-center rounded-full bg-[#eaf3ff] text-[#4c88fb] sm:h-[66px] sm:w-[66px]">
                  <Activity className="h-7 w-7" strokeWidth={2} aria-hidden />
                </span>
                <div className="min-w-0 flex-1">
                  <ButtonLink
                    to="/signup"
                    variant="ghost"
                    withArrow
                    className="justify-start px-0 text-[16px] font-semibold text-[#1e3150] hover:text-[#4779f5] sm:text-[18px]"
                  >
                    Start Monitoring
                  </ButtonLink>
                  <p className="mt-1 text-[11px] text-[#8493aa]">
                    Already have a workspace?{' '}
                    <TextLink to="/login" showArrow={false} className="text-[#4779f5] underline">
                      Sign in
                    </TextLink>
                  </p>
                </div>
              </div>

              <div className="mt-6 flex items-start gap-3 border-t border-[#e4ebf5] pt-5">
                <Info className="mt-0.5 h-[19px] w-[19px] shrink-0 rounded-full bg-[#eaf3ff] p-[3px] text-[#5798f7]" aria-hidden />
                <p className="text-[10px] leading-[1.7] text-[#8191a9] sm:text-[11px]">
                  Checks begin only after you activate them. Nothing is monitored by accident.
                </p>
              </div>
            </div>
          </Reveal>
        </div>
      </Container>
    </section>
  );
}

export default function Landing() {
  const location = useLocation();

  usePageMeta({
    title: 'BreakGlass — website monitoring for agencies',
    description:
      'BreakGlass monitors the websites your agency manages with HTTP uptime, API and browser-journey checks, then opens one incident with the evidence attached.',
    path: '/',
  });

  // Support links such as /#for-agencies from other pages.
  useEffect(() => {
    if (!location.hash) return;
    const target = document.querySelector<HTMLElement>(location.hash);
    if (!target) return;
    const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    window.requestAnimationFrame(() => {
      target.scrollIntoView({ behavior: reduceMotion ? 'auto' : 'smooth', block: 'start' });
    });
  }, [location.hash]);

  return (
    <div className="min-h-screen bg-paper">
      <SiteHeader overHero />
      <main id="main" className="landing-main">
        <Hero />
        <ProductSection />
        <HowItWorksSection />
        <AgenciesSection />
        <FinalCta />
      </main>
      <SiteFooter />
    </div>
  );
}
