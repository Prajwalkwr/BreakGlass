import { SiteFooter } from '../../components/marketing/SiteFooter';
import { SiteHeader } from '../../components/marketing/SiteHeader';
import { Container, Eyebrow } from '../../components/marketing/ui';
import { usePageMeta } from '../../lib/usePageMeta';

function LegalPage({
  eyebrow,
  title,
  updated,
  intro,
  children,
}: {
  eyebrow: string;
  title: string;
  updated: string;
  intro: string;
  children: React.ReactNode;
}) {
  return (
    <div className="min-h-screen bg-paper">
      <SiteHeader />
      <main id="main" className="pt-16">
        <Container className="max-w-3xl py-16 sm:py-20">
          <Eyebrow>{eyebrow}</Eyebrow>
          <h1 className="mt-5 text-display-md font-medium uppercase tracking-[-0.02em] text-ink-900">{title}</h1>
          <p className="mt-4 text-[12px] uppercase tracking-[0.16em] text-ink-400">Last updated {updated}</p>
          <p className="mt-8 text-[15px] leading-[1.8] text-ink-600">{intro}</p>
          <div className="mt-10 space-y-10">{children}</div>
        </Container>
      </main>
      <SiteFooter />
    </div>
  );
}

function Clause({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="border-t border-paper-300 pt-6">
      <h2 className="text-[15px] font-semibold text-ink-900">{title}</h2>
      <div className="mt-3 space-y-3 text-[14px] leading-[1.8] text-ink-500">{children}</div>
    </section>
  );
}

export function Privacy() {
  usePageMeta({
    title: 'Privacy',
    description: 'What BreakGlass stores, why it stores it, and which third parties can receive data.',
    path: '/privacy',
  });

  return (
    <LegalPage
      eyebrow="Legal"
      title="Privacy"
      updated="27 October 2026"
      intro="This page describes exactly what this BreakGlass deployment stores, because the honest answer is more useful than a template. It reflects the code in this repository: if a field is listed here, it exists in the database."
    >
      <Clause title="What we store about you">
        <p>
          Your name, email address, a bcrypt hash of your password (never the password itself), your
          timezone, and when your password was last changed. Authentication uses an opaque session
          token stored in an httpOnly, same-site cookie; the token is hashed in the database, and
          signing out revokes that session.
        </p>
      </Clause>

      <Clause title="What we store about the sites you monitor">
        <p>
          The URLs, names, client labels and notes you enter, the configuration of each check
          (including expected status ranges and browser journey steps), every check run with its
          status, duration, failure category and a sanitized evidence snapshot, incidents with their
          timelines, and any failure artifacts such as screenshots. Deployment events are stored only
          if you connect a repository webhook.
        </p>
        <p>
          Credentials used by checks — API headers and browser test-account passwords — are encrypted
          with AES-256-GCM before they are written, decrypted only inside the monitoring worker, and
          never returned by the API.
        </p>
      </Clause>

      <Clause title="Who else can see it">
        <p>
          Email alerts are delivered through the provider configured for this deployment (SMTP or
          Resend). That provider receives the recipient address and the alert body. If you add a Slack
          destination, incident summaries are posted to the webhook URL you supply. No analytics,
          advertising, tracking pixels or third-party scripts are used anywhere in this application.
        </p>
      </Clause>

      <Clause title="How long it is kept">
        <p>
          Runs, incidents, artifacts and delivery records stay until they are deleted by the operator
          of this deployment or by you through the application. This build does not yet enforce an
          automatic retention window; that is a documented gap rather than a feature we claim to
          have.
        </p>
      </Clause>

      <Clause title="Your requests">
        <p>
          This is self-hosted software: the person or organisation operating this deployment is
          responsible for handling access, export and deletion requests. If you do not know who that
          is, you are probably on a private instance rather than a public service.
        </p>
      </Clause>
    </LegalPage>
  );
}

export function Terms() {
  usePageMeta({
    title: 'Terms',
    description: 'The terms that apply to using this BreakGlass deployment.',
    path: '/terms',
  });

  return (
    <LegalPage
      eyebrow="Legal"
      title="Terms"
      updated="27 October 2026"
      intro="BreakGlass is monitoring software. These terms describe what it does, what it does not promise, and what you are responsible for. They are deliberately short."
    >
      <Clause title="The service">
        <p>
          BreakGlass schedules and executes HTTP, API and browser checks against the URLs you
          configure, records the results, and notifies you when a check fails repeatedly enough to
          open an incident. Monitoring runs on the server; it does not require your browser to be
          open.
        </p>
      </Clause>

      <Clause title="No availability guarantee">
        <p>
          This deployment has no service-level agreement. Checks run at the fastest interval the
          scheduler supports, but a website can fail between two checks, and check execution, alert
          delivery and email providers can be delayed. BreakGlass reports what it observed; it is not
          a substitute for your own incident response.
        </p>
      </Clause>

      <Clause title="What you may point it at">
        <p>
          Only monitor sites and endpoints you own or have explicit permission to test. Checks send
          real requests to the targets you configure. Private, loopback, link-local and cloud-metadata
          addresses are blocked by the application's SSRF protections, so internal targets will fail
          validation rather than being monitored.
        </p>
      </Clause>

      <Clause title="Your responsibilities">
        <p>
          Keep your account credentials safe, use a dedicated test account rather than a real
          employee login for browser journeys, and make sure any credentials you store are ones you
          are allowed to use. You are responsible for the content of the sites being monitored and for
          acting on incidents.
        </p>
      </Clause>

      <Clause title="Changes">
        <p>
          This software may change without notice, including the behaviour of checks and the shape of
          stored data. Features described on the marketing pages as &ldquo;not in this release&rdquo;
          are not available, and nothing on those pages is a commitment to deliver them.
        </p>
      </Clause>
    </LegalPage>
  );
}
