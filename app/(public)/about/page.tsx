import type { Metadata } from 'next';
import Link from 'next/link';
import { ArrowRight, CalendarDays, ListTodo, Mail, StickyNote } from 'lucide-react';
import { plannerPublicDetails } from '@/lib/publicSite';

export const metadata: Metadata = {
  title: 'About Planner',
  description: 'Planner is a personal-use application for tasks, projects, calendars, notes, and AI-assisted capture from text and email.',
};

const features = [
  { icon: CalendarDays, title: 'See your day clearly', text: 'Bring calendar events and tasks together, with day, week, month, and year views.' },
  { icon: ListTodo, title: 'Make room for what matters', text: 'Organize projects, recurring tasks, goals, and a backlog for things to do later.' },
  { icon: Mail, title: 'Capture the next step', text: 'Turn free-form text or an email into a suggested task or calendar event with AI assistance.' },
  { icon: StickyNote, title: 'Keep a running notepad', text: 'Write down open questions and ideas, then turn individual notes into tasks or projects.' },
];

export default function AboutPage() {
  return (
    <>
      <section className="max-w-2xl">
        <p className="mb-4 text-[12px] font-semibold uppercase tracking-[0.16em] text-[#5b66b3]">About Planner</p>
        <h1 className="text-[36px] font-semibold leading-[1.12] tracking-[-0.04em] sm:text-[52px]">
          A personal home for<br className="hidden sm:block" /> your everyday plans.
        </h1>
        <p className="mt-6 max-w-xl text-[17px] leading-8 text-[#566078]">
          Planner brings tasks, projects, calendars, and notes into one quiet workspace.
          It is a personal-use application maintained by {plannerPublicDetails.maintainer} to make daily planning easier.
        </p>
      </section>

      <section aria-label="Planner features" className="mt-10 grid gap-4 sm:mt-12 sm:grid-cols-2">
        {features.map(({ icon: Icon, title, text }) => (
          <div key={title} className="rounded-2xl border border-[#e1e5ee] bg-white px-6 py-6">
            <Icon size={20} strokeWidth={1.7} className="mb-5 text-[#6874cd]" aria-hidden="true" />
            <h2 className="text-[16px] font-semibold tracking-tight">{title}</h2>
            <p className="mt-2 text-[14px] leading-6 text-[#626c81]">{text}</p>
          </div>
        ))}
      </section>

      <section className="mt-10 rounded-2xl border border-[#dfe3f4] bg-[#eef0fb] px-6 py-7 sm:mt-12 sm:px-8">
        <h2 className="text-[19px] font-semibold tracking-tight">How connected features use data</h2>
        <div className="mt-4 space-y-4 text-[14px] leading-7 text-[#535e77]">
          <p>
            Connecting Google lets Planner display calendar events and create, change, move, or delete events as requested.
            Gmail access supports reading emails for task and event suggestions, archiving messages, and processing emails
            assigned to configured automation labels. Those automations can create items and send confirmation emails.
          </p>
          <p>
            AI capture sends the text you submit to OpenAI. Email-based AI features also send relevant email content,
            including the subject and body, and sender details for label-based automations. This processing helps extract
            titles, dates, times, and notes. Label-based automations can run in the background once configured.
          </p>
          <p>
            The privacy policy explains these connections, storage, retention, and how to revoke access or request deletion.
          </p>
        </div>
        <Link href="/privacy" className="mt-5 inline-flex items-center gap-2 text-[14px] font-semibold text-[#424fb3] underline decoration-[#bec5eb] underline-offset-4">
          Read the privacy policy <ArrowRight size={15} aria-hidden="true" />
        </Link>
      </section>

      <section className="mt-10 border-t border-[#e1e5ee] pt-7 sm:mt-12">
        <h2 className="text-[16px] font-semibold">A small, personal project</h2>
        <p className="mt-3 max-w-2xl text-[14px] leading-7 text-[#626c81]">
          Planner is built for personal use. These public pages describe the application and its data practices;
          they do not display calendar entries, emails, tasks, or private notes.
        </p>
        <p className="mt-4 text-[14px] text-[#626c81]">
          Questions or privacy requests?{' '}
          <a href={`mailto:${plannerPublicDetails.supportEmail}`} className="break-all font-medium text-[#424fb3] underline decoration-[#bec5eb] underline-offset-4">
            {plannerPublicDetails.supportEmail}
          </a>
        </p>
      </section>
    </>
  );
}
