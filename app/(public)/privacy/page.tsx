import type { Metadata } from 'next';
import Link from 'next/link';
import { plannerPublicDetails } from '@/lib/publicSite';

export const metadata: Metadata = {
  title: 'Privacy policy | Planner',
  description: 'How Planner accesses, uses, stores, and shares planning data, Google Calendar and Gmail information, and content submitted to AI features.',
};

const sections = [
  ['data', 'Information Planner handles'],
  ['google', 'Google access and automations'],
  ['ai', 'AI processing and service providers'],
  ['storage', 'Storage and security'],
  ['retention', 'Retention and deletion'],
  ['control', 'Your controls'],
  ['limited-use', 'Google Limited Use'],
  ['contact', 'Changes and contact'],
] as const;

function PolicySection({ id, title, children }: { id: string; title: string; children: React.ReactNode }) {
  return (
    <section id={id} className="scroll-mt-8 border-t border-[#e6e8f0] pt-7">
      <h2 className="mb-3 text-[19px] font-semibold tracking-tight text-[#202434]">{title}</h2>
      <div className="space-y-4 text-[14px] leading-7 text-[#556078] [&_a]:break-words [&_a]:text-[#424fb3] [&_a]:underline [&_a]:decoration-[#bec5eb] [&_a]:underline-offset-4">
        {children}
      </div>
    </section>
  );
}

export default function PrivacyPage() {
  return (
    <article className="mx-auto max-w-3xl">
      <p className="mb-4 text-[12px] font-semibold uppercase tracking-[0.16em] text-[#5b66b3]">Planner · Privacy</p>
      <h1 className="text-[36px] font-semibold leading-tight tracking-[-0.04em] sm:text-[48px]">Privacy policy</h1>
      <p className="mt-3 text-[12px] text-[#6c758b]">Last updated {plannerPublicDetails.policyUpdated}</p>
      <p className="mt-6 text-[16px] leading-8 text-[#556078]">
        Planner is a personal-use application maintained by {plannerPublicDetails.maintainer}.
        This policy explains what happens to planning data and information from connected accounts when using Planner.
        Contact{' '}
        <a href={`mailto:${plannerPublicDetails.supportEmail}`} className="break-all text-[#424fb3] underline decoration-[#bec5eb] underline-offset-4">
          {plannerPublicDetails.supportEmail}
        </a>{' '}
        with questions or deletion requests.
      </p>

      <nav aria-label="Privacy policy sections" className="my-8 rounded-2xl border border-[#e0e4ee] bg-white p-5 sm:p-6">
        <p className="mb-3 text-[12px] font-semibold uppercase tracking-[0.1em] text-[#68728b]">On this page</p>
        <ol className="grid gap-x-6 gap-y-2 sm:grid-cols-2">
          {sections.map(([id, title], index) => (
            <li key={id} className="text-[13px] leading-6">
              <a href={`#${id}`} className="text-[#465379] hover:underline hover:underline-offset-4">
                <span className="mr-2 text-[#8b94aa]">{index + 1}.</span>{title}
              </a>
            </li>
          ))}
        </ol>
      </nav>

      <div className="space-y-8 rounded-2xl border border-[#e0e4ee] bg-white p-6 sm:p-9 [&_section:first-child]:border-0 [&_section:first-child]:pt-0">
        <PolicySection id="data" title="1. Information Planner handles">
          <p>
            Planner handles the tasks, projects, goals, tags, recurring schedules, notes, and other planning information
            entered into the application. Browser storage keeps preferences, locally held lists, and a copy of the notepad
            for use between visits and recovery while offline.
          </p>
          <p>
            Google integrations handle calendar names and identifiers, event titles, dates, times, descriptions, and
            relevant event details; Gmail integrations handle message identifiers, headers, subjects, senders, message
            bodies, and labels needed for email features. Optional Apple integrations access configured calendars and
            birthday/contact information. Film and TV searches send the search query to Watchmode.
          </p>
        </PolicySection>

        <PolicySection id="google" title="2. Google access and automations">
          <p>
            Google authorization allows Planner to display calendars and to create, edit, move, or delete events for
            planning actions. Gmail access lets the email panel show messages, generate task or event suggestions,
            archive or restore messages, and manage labels used by automations.
          </p>
          <p>
            When configured, emails assigned to the task or calendar automation labels (normally Planner/Tasks and
            Planner/Calendar) can be processed in the background. The automation reads their content, uses AI to extract planning details, creates tasks or calendar
            events, updates processing labels, and sends confirmation messages. Processing history can include message
            identifiers, sender and subject, extracted details, created item identifiers, status, and error information.
          </p>
        </PolicySection>

        <PolicySection id="ai" title="3. AI processing and service providers">
          <p>
            OpenAI processes text submitted to AI capture and titles submitted for emoji suggestions. Email-based AI
            features send the relevant email subject and body, instructions, and date/time context; automated email
            processing can also include sender information. The generated output is used for the requested planning feature.
          </p>
          <p>
            Planner does not use Google Workspace data to develop, improve, or train generalized AI or machine-learning
            models. OpenAI states that API data is not used for model training by default. Its account settings and{' '}
            <a href="https://developers.openai.com/api/docs/guides/your-data">API data controls and retention rules</a>{' '}
            govern its processing; AI requests and responses may be retained by the provider.
          </p>
          <p>
            Google and Apple process requests to their connected services. Watchmode processes film and TV search
            requests. Hosting and network providers process data needed to deliver and operate the application, which
            may include request metadata such as IP addresses, browser details, and timestamps. These providers may
            process information in countries other than the account holder’s country.
          </p>
        </PolicySection>

        <PolicySection id="storage" title="4. Storage and security">
          <p>
            Planner uses Google sign-in restricted to its owner. A persistent, secure, HTTP-only session cookie
            remembers each signed-in device. The backend stores the owner’s Google account identifier and hashed
            session credentials. Sessions expire after 30 days of inactivity or 90 days from sign-in and can be revoked
            through the app. About and Privacy pages remain public; private planning data requires authenticated access.
          </p>
          <p>
            Planner stores planning records, shared notes, Google authorization tokens, and email automation history on
            its backend. Some preferences and lists are stored in the browser. Google tokens enable ongoing access and
            automatic refresh while the authorization remains valid.
          </p>
          <p>
            Connections to Google and OpenAI use HTTPS. The maintainer manages the application’s hosting and service
            accounts. Security and access controls also depend on the deployment and provider configuration; this policy
            does not promise end-to-end encryption or zero retention by service providers.
          </p>
        </PolicySection>

        <PolicySection id="retention" title="5. Retention and deletion">
          <p>
            Planning data is retained to support continued use until it is deleted through the app or removed by the
            maintainer. Stored authorization credentials and automation history remain until removed by the maintainer;
            the application currently has no automatic expiry schedule for those records.
          </p>
          <p>
            Deleting a task or event does not automatically erase its source email, automation history, or records retained
            by external providers. Clearing browser storage removes that browser’s local copy; it does not erase shared
            backend notes or Google data. Provider logs and any infrastructure backups have separate retention periods
            controlled by the relevant provider or hosting configuration.
          </p>
          <p>
            For deletion of backend records, authorization tokens, or automation history, email{' '}
            <a href={`mailto:${plannerPublicDetails.supportEmail}?subject=Planner%20data%20deletion`}>{plannerPublicDetails.supportEmail}</a>.
            The maintainer can explain which records can be removed and any remaining provider-side limitations.
          </p>
        </PolicySection>

        <PolicySection id="control" title="6. Your controls">
          <ul className="list-disc space-y-2 pl-5">
            <li>Choose which text or emails to submit to AI features. Review generated suggestions before using them.</li>
            <li>Remove automation labels from emails and ask the maintainer to disable background processing to stop future automated handling.</li>
            <li>Revoke Planner’s authorization through <a href="https://myaccount.google.com/connections">Google Account connections</a>. Revocation stops future authorized access, but existing Planner records need to be deleted separately.</li>
            <li>Delete planning items through the app and contact the maintainer for data that has no deletion control in the interface.</li>
          </ul>
        </PolicySection>

        <PolicySection id="limited-use" title="7. Google Limited Use">
          <p>
            Planner uses Google data to provide its personal planning features. It does not sell this data, use it for
            advertising, or use it to train generalized AI models. Transfers to service providers support these features.
          </p>
          <p>
            Information received from Google APIs will be used and transferred only as permitted by the{' '}
            <a href="https://developers.google.com/terms/api-services-user-data-policy">Google API Services User Data Policy</a>,
            including its Limited Use requirements, and the{' '}
            <a href="https://developers.google.com/workspace/workspace-api-user-data-developer-policy">Google Workspace user data policy</a>.
          </p>
        </PolicySection>

        <PolicySection id="contact" title="8. Changes and contact">
          <p>
            This page will be updated as Planner’s features or data practices change. Material changes to connected-account
            data use should be explained before that new use begins, with consent obtained where required.
          </p>
          <p>
            Support and privacy contact:{' '}
            <a href={`mailto:${plannerPublicDetails.supportEmail}`}>{plannerPublicDetails.supportEmail}</a>.
            Read more <Link href="/about">about Planner</Link>.
          </p>
        </PolicySection>
      </div>
    </article>
  );
}
