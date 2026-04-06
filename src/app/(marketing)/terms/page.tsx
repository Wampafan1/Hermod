export const metadata = {
  title: "Terms of Service — Hermod",
  description: "Terms and conditions for using the Hermod automated data delivery platform.",
};

export default function TermsOfService() {
  return (
    <article className="max-w-3xl mx-auto px-8 py-20">
      <p className="font-mono text-[#a06800] text-xs font-bold tracking-[0.4em] uppercase mb-4">Legal</p>
      <h1 className="font-headline text-4xl md:text-5xl font-black text-[#2a2520] tracking-tight mb-2">Terms of Service</h1>
      <p className="font-mono text-xs text-slate-400 tracking-wider mb-12">Last updated: April 5, 2026</p>

      <div className="prose-hermod space-y-8 text-[#4a4035] leading-relaxed">

        <section>
          <h2 className="font-headline text-xl font-bold text-[#2a2520] mb-3">1. Acceptance of Terms</h2>
          <p>
            By accessing or using Hermod (&ldquo;the Service&rdquo;), you agree to be bound by these Terms of
            Service (&ldquo;Terms&rdquo;). If you do not agree to these Terms, do not use the Service. Hermod
            offers three subscription tiers: Heimdall (free), Thor ($99/month), and Odin ($299/month). Feature
            availability varies by tier as described on the Pricing page at hermodforge.com. These Terms apply
            to all users of the Service, regardless of subscription tier.
          </p>
        </section>

        <section>
          <h2 className="font-headline text-xl font-bold text-[#2a2520] mb-3">2. Description of Service</h2>
          <p>
            Hermod is an automated data delivery platform that moves data between databases, APIs, file systems,
            and cloud services on schedules you configure. The Odin tier includes AI-powered data formatting
            features (Mj&ouml;lnir) that use artificial intelligence to generate transformation blueprints
            during a one-time setup process. After setup, all scheduled deliveries run as reliable, repeatable
            code with no AI involvement.
          </p>
        </section>

        <section>
          <h2 className="font-headline text-xl font-bold text-[#2a2520] mb-3">3. Accounts</h2>
          <p>
            You must create an account to use Hermod. You authenticate via supported third-party identity
            providers, including Google and Microsoft. You are responsible for maintaining the security of your
            authentication account and any credentials you store within Hermod (database connection strings,
            API keys, service account files, etc.).
          </p>
          <p className="mt-3">
            You agree to provide accurate information and to promptly update any information that changes.
            You are responsible for all activity that occurs under your account.
          </p>
        </section>

        <section>
          <h2 className="font-headline text-xl font-bold text-[#2a2520] mb-3">4. Acceptable Use</h2>
          <p>You agree not to use Hermod to:</p>
          <ul className="list-disc pl-6 space-y-2 mt-3">
            <li>Violate any applicable law, regulation, or third-party rights</li>
            <li>Transmit data you do not have the right to move or process</li>
            <li>Attempt to gain unauthorized access to other users&rsquo; accounts, data, or configured deliveries</li>
            <li>Reverse-engineer, decompile, or disassemble any part of the Service</li>
            <li>Use the Service to build a competing product using substantially similar features</li>
            <li>Overload the Service infrastructure through abusive API usage or intentionally excessive scheduling</li>
            <li>Store or transmit malicious code, malware, or harmful content through the Service</li>
          </ul>
        </section>

        <section>
          <h2 className="font-headline text-xl font-bold text-[#2a2520] mb-3">5. Your Data</h2>
          <p>
            You retain all ownership rights to the data that flows through your configured deliveries. Hermod
            does not claim ownership of your data. We process your data solely to provide the Service as you
            have configured it. See our <a href="/privacy" className="text-[#a06800] underline hover:text-amber-900">Privacy Policy</a> for
            details on how we handle your data.
          </p>
          <p className="mt-3">
            You are responsible for ensuring that you have the right to move, transform, and store the data
            you configure in your deliveries. Hermod is not responsible for the content, accuracy, or legality
            of data processed through the Service.
          </p>
        </section>

        <section>
          <h2 className="font-headline text-xl font-bold text-[#2a2520] mb-3">6. Service Tiers &amp; Pricing</h2>

          <h3 className="font-bold text-[#2a2520] mt-4 mb-2">Heimdall (Free Tier)</h3>
          <p>
            The Heimdall tier provides the full delivery engine with manual configuration, cloud database
            connections, all supported connectors and destinations, and email delivery via Hermod&rsquo;s SMTP
            service (includes Hermod branding) at no cost. Community support is included.
          </p>

          <h3 className="font-bold text-[#2a2520] mt-4 mb-2">Thor ($99/month)</h3>
          <p>
            The Thor tier includes everything in Heimdall plus the Hermod Data Agent for on-premises database
            connections, webhook and real-time triggers, hourly scheduling, and email support.
          </p>

          <h3 className="font-bold text-[#2a2520] mt-4 mb-2">Odin ($299/month)</h3>
          <p>
            The Odin tier includes everything in Thor plus Mj&ouml;lnir AI-powered data formatting, automatic
            API connector setup, custom email branding and SMTP configuration, and priority support.
          </p>

          <p className="mt-3">
            Pricing and feature availability are subject to change. Current pricing is always available at
            hermodforge.com. Changes to pricing will be communicated via email at least 30 days before taking
            effect for existing subscribers. Price changes do not apply retroactively to the current billing period.
          </p>
        </section>

        <section>
          <h2 className="font-headline text-xl font-bold text-[#2a2520] mb-3">7. Payment &amp; Billing</h2>
          <p>
            Thor and Odin subscriptions are billed monthly. Payment is due at the beginning of each billing
            period. If payment fails, we will attempt to charge the payment method on file for up to 7 days.
            If payment is not received within 7 days, your account may be downgraded to the Heimdall tier.
            Existing deliveries will continue to run but tier-specific features will be disabled until payment
            is restored.
          </p>
        </section>

        <section>
          <h2 className="font-headline text-xl font-bold text-[#2a2520] mb-3">8. Cancellation &amp; Refunds</h2>
          <p>
            You may cancel your paid subscription at any time. Cancellation takes effect at the end of
            the current billing period. No prorated refunds are provided for partial months. Upon cancellation,
            your account reverts to the Heimdall tier. Your deliveries, blueprints, and configurations are
            preserved &mdash; only tier-specific features are disabled.
          </p>
          <p className="mt-3">
            You may delete your account at any time by contacting us. Account deletion is permanent and will
            remove all your data within 30 days as described in our Privacy Policy.
          </p>
        </section>

        <section>
          <h2 className="font-headline text-xl font-bold text-[#2a2520] mb-3">9. Service Availability</h2>
          <p>
            We strive to maintain high availability but do not guarantee uninterrupted access to the Service.
            The Service may be temporarily unavailable due to maintenance, updates, or circumstances beyond our
            control. We will make reasonable efforts to notify users of planned maintenance in advance.
          </p>
        </section>

        <section>
          <h2 className="font-headline text-xl font-bold text-[#2a2520] mb-3">10. AI-Generated Blueprints</h2>
          <p>
            Transformation blueprints generated by Mj&ouml;lnir (available on the Odin tier) are produced using
            artificial intelligence. While we strive for accuracy, AI-generated blueprints require human review
            and approval before deployment. You are responsible for reviewing, testing, and approving all
            blueprints before they are used in production deliveries. Hermod is not liable for data loss,
            corruption, or errors resulting from blueprints you have approved and deployed.
          </p>
        </section>

        <section>
          <h2 className="font-headline text-xl font-bold text-[#2a2520] mb-3">11. Hermod Data Agent</h2>
          <p>
            The Hermod Data Agent is a locally-installed Windows application available to Thor and Odin
            subscribers. The Data Agent executes read-only SQL queries against the subscriber&rsquo;s databases
            and transmits results to Hermod&rsquo;s cloud service via outbound HTTPS. Hermod does not initiate
            inbound connections to the subscriber&rsquo;s network. You are responsible for ensuring the Data
            Agent is installed on a machine with appropriate database access permissions and that your use
            complies with your organization&rsquo;s security policies.
          </p>
        </section>

        <section>
          <h2 className="font-headline text-xl font-bold text-[#2a2520] mb-3">12. Intellectual Property</h2>
          <p>
            The Service, including its design, code, branding, architecture, and documentation, is owned by
            Hermod Software LLC and protected by intellectual property laws. Your use of the Service does not
            grant you any ownership rights to the platform itself.
          </p>
          <p className="mt-3">
            Transformation blueprints generated for your account are yours. You may export, modify, and use
            them as you see fit.
          </p>
        </section>

        <section>
          <h2 className="font-headline text-xl font-bold text-[#2a2520] mb-3">13. Limitation of Liability</h2>
          <p>
            To the maximum extent permitted by law, Hermod shall not be liable for any indirect, incidental,
            special, consequential, or punitive damages, including but not limited to loss of profits, data,
            or business opportunities, arising from your use of the Service.
          </p>
          <p className="mt-3">
            Our total liability for any claim arising from these Terms or the Service shall not exceed the
            amount you paid to Hermod in the twelve (12) months preceding the claim, or $100, whichever is greater.
          </p>
        </section>

        <section>
          <h2 className="font-headline text-xl font-bold text-[#2a2520] mb-3">14. Disclaimer of Warranties</h2>
          <p>
            The Service is provided &ldquo;as is&rdquo; and &ldquo;as available&rdquo; without warranties of any
            kind, whether express or implied, including but not limited to implied warranties of merchantability,
            fitness for a particular purpose, and non-infringement.
          </p>
        </section>

        <section>
          <h2 className="font-headline text-xl font-bold text-[#2a2520] mb-3">15. Indemnification</h2>
          <p>
            You agree to indemnify and hold harmless Hermod Software LLC from any claims, losses, liabilities,
            and expenses (including attorney&rsquo;s fees) arising from your use of the Service, your violation
            of these Terms, or your violation of any third-party rights.
          </p>
        </section>

        <section>
          <h2 className="font-headline text-xl font-bold text-[#2a2520] mb-3">16. Termination</h2>
          <p>
            We may suspend or terminate your access to the Service at any time if you violate these Terms or
            engage in activity that harms the Service or other users. Upon termination, your right to use the
            Service ceases immediately. Provisions that by their nature should survive termination (including
            Limitation of Liability, Disclaimer of Warranties, and Indemnification) will remain in effect.
          </p>
        </section>

        <section>
          <h2 className="font-headline text-xl font-bold text-[#2a2520] mb-3">17. Changes to Terms</h2>
          <p>
            We may revise these Terms from time to time. We will notify you of material changes by posting the
            updated Terms on this page and updating the &ldquo;Last updated&rdquo; date. Continued use of the
            Service after changes are posted constitutes acceptance of the updated Terms.
          </p>
        </section>

        <section>
          <h2 className="font-headline text-xl font-bold text-[#2a2520] mb-3">18. Governing Law</h2>
          <p>
            These Terms are governed by the laws of the State of Mississippi, without regard to its conflict of
            laws provisions. Any disputes arising from these Terms shall be resolved in the state or federal
            courts located in the State of Mississippi.
          </p>
        </section>

        <section>
          <h2 className="font-headline text-xl font-bold text-[#2a2520] mb-3">19. Contact</h2>
          <p>For questions about these Terms, contact us at:</p>
          <p className="mt-3 font-mono text-sm text-[#a06800]">legal@hermodforge.com</p>
        </section>

      </div>
    </article>
  );
}
