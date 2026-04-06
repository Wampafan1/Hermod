export const metadata = {
  title: "Privacy Policy — Hermod",
  description: "How Hermod collects, uses, and protects your data. Covers all tiers: Heimdall, Thor, and Odin.",
};

export default function PrivacyPolicy() {
  return (
    <article className="max-w-3xl mx-auto px-8 py-20">
      <p className="font-mono text-[#a06800] text-xs font-bold tracking-[0.4em] uppercase mb-4">Legal</p>
      <h1 className="font-headline text-4xl md:text-5xl font-black text-[#2a2520] tracking-tight mb-2">Privacy Policy</h1>
      <p className="font-mono text-xs text-slate-400 tracking-wider mb-12">Last updated: April 5, 2026</p>

      <div className="prose-hermod space-y-8 text-[#4a4035] leading-relaxed">

        <section>
          <h2 className="font-headline text-xl font-bold text-[#2a2520] mb-3">1. Data Controller &amp; Contact Information</h2>
          <p>
            Hermod (&ldquo;we,&rdquo; &ldquo;us,&rdquo; &ldquo;our&rdquo;) is an automated data delivery platform operated by:
          </p>
          <div className="mt-3 p-4 bg-slate-50 border border-slate-200 text-sm">
            <p className="font-bold text-[#2a2520]">Hermod Software LLC</p>
            <p>United States</p>
            <p className="mt-2">A designated Privacy Officer is responsible for data protection compliance.</p>
            <p>Email: <span className="font-mono text-[#a06800]">privacy@hermodforge.com</span></p>
          </div>
          <p className="mt-3">
            For users in the European Economic Area (EEA), Hermod Software LLC acts as the data controller
            for your personal data. If you are located in the EU/EEA, you may also contact our EU representative
            at the email address above.
          </p>
        </section>

        <section>
          <h2 className="font-headline text-xl font-bold text-[#2a2520] mb-3">2. Information We Collect</h2>

          <h3 className="font-bold text-[#2a2520] mt-4 mb-2">2.1 Account Information (Identifiers)</h3>
          <p>
            When you sign up using a supported identity provider (Google or Microsoft), we receive your
            name, email address, and profile picture. We do not receive or store your identity provider password.
          </p>

          <h3 className="font-bold text-[#2a2520] mt-4 mb-2">2.2 Connection Credentials (Sensitive Personal Information)</h3>
          <p>
            To connect your data sources and destinations (databases, APIs, SFTP servers, etc.), you provide
            credentials such as connection strings, API keys, or service account files. These credentials are
            encrypted at rest using AES-256-GCM and are used solely to execute your configured routes.
            A &ldquo;Route&rdquo; is a configured automated delivery from a data source to a destination.
          </p>

          <h3 className="font-bold text-[#2a2520] mt-4 mb-2">2.3 Route Data (Customer Data)</h3>
          <p>
            Hermod processes the data that flows through your routes (database rows, API responses, file
            contents). This data is transmitted between your configured source and destination but is <strong>not
            stored permanently</strong> by Hermod. Temporary processing occurs in memory during route execution.
            Failed delivery data may be temporarily stored in the error recovery queue for retry purposes
            and is automatically purged after successful recovery or a maximum of 30 days.
          </p>

          <h3 className="font-bold text-[#2a2520] mt-4 mb-2">2.4 Usage &amp; Internet Activity Data</h3>
          <p>
            We collect route execution logs (row counts, timing, error messages, success/failure status),
            blueprint version history, and general usage analytics. This data does not contain your actual
            route payload data.
          </p>

          <h3 className="font-bold text-[#2a2520] mt-4 mb-2">2.5 AI Processing Data</h3>
          <p>
            When you use Mj&ouml;lnir (our AI-powered data formatting feature, available on the Odin tier), a sample of data from your uploaded files is sent to
            our AI sub-processor (Anthropic Claude) to generate transformation blueprints. Specifically, the
            <strong> first 50 rows</strong> of your uploaded BEFORE and AFTER files are sent. This occurs <strong>only
            during the one-time setup step</strong>. You review and approve the AI-generated blueprint before
            deployment. Once approved, no data is sent to any AI service during scheduled route runs.
          </p>
        </section>

        <section>
          <h2 className="font-headline text-xl font-bold text-[#2a2520] mb-3">3. Legal Basis for Processing (GDPR Art. 6 / LGPD Art. 7)</h2>
          <p>We process your personal data under the following legal bases:</p>
          <div className="mt-3 space-y-4">
            <div className="p-4 bg-slate-50 border border-slate-200">
              <p className="font-bold text-[#2a2520] text-sm">Contract Performance (Art. 6(1)(b))</p>
              <p className="text-sm mt-1">Account creation, route execution, blueprint generation, credential storage, error recovery &mdash; all necessary to provide the service you requested.</p>
            </div>
            <div className="p-4 bg-slate-50 border border-slate-200">
              <p className="font-bold text-[#2a2520] text-sm">Legitimate Interest (Art. 6(1)(f))</p>
              <p className="text-sm mt-1">Usage analytics, performance monitoring, security logging, and service improvement. Our interest in maintaining and improving the service is balanced against your privacy rights. You may object to this processing (see Section 7).</p>
            </div>
            <div className="p-4 bg-slate-50 border border-slate-200">
              <p className="font-bold text-[#2a2520] text-sm">Consent (Art. 6(1)(a))</p>
              <p className="text-sm mt-1">AI processing via Mj&ouml;lnir &mdash; when you upload files and click &ldquo;Forge,&rdquo; you consent to sample data being sent to Anthropic Claude for blueprint generation. You may withdraw consent at any time by not using the Mj&ouml;lnir feature. The Heimdall (free) and Thor tiers provide manual configuration with no AI processing. AI-powered formatting (Mj&ouml;lnir) is available on the Odin tier only.</p>
            </div>
            <div className="p-4 bg-slate-50 border border-slate-200">
              <p className="font-bold text-[#2a2520] text-sm">Legal Obligation (Art. 6(1)(c))</p>
              <p className="text-sm mt-1">Where required to comply with applicable laws, regulatory requirements, or valid legal processes.</p>
            </div>
          </div>
        </section>

        <section>
          <h2 className="font-headline text-xl font-bold text-[#2a2520] mb-3">4. How We Use Your Information</h2>
          <ul className="list-disc pl-6 space-y-2 mt-3">
            <li>Authenticate your account and manage your session (contract)</li>
            <li>Execute your configured routes on schedule (contract)</li>
            <li>Generate AI-powered transformation blueprints when you use Mj&ouml;lnir (consent)</li>
            <li>Provide route monitoring, error alerts, and execution history (contract)</li>
            <li>Maintain and improve the reliability and performance of the service (legitimate interest)</li>
            <li>Communicate with you about your account, service updates, and support (contract / legitimate interest)</li>
            <li>Comply with legal obligations and respond to lawful requests (legal obligation)</li>
          </ul>
          <p className="mt-3">
            We do <strong>not</strong> sell, rent, or share your personal information for cross-context behavioral
            advertising. We do not use your route data for advertising, profiling, or model training purposes.
          </p>
        </section>

        <section>
          <h2 className="font-headline text-xl font-bold text-[#2a2520] mb-3">5. Data Storage, Transfers &amp; Security</h2>

          <h3 className="font-bold text-[#2a2520] mt-4 mb-2">5.1 Data Hosting</h3>
          <p>
            Account data and route configurations are stored in PostgreSQL databases hosted in the
            <strong> United States</strong>. Connection credentials are encrypted at rest using AES-256-GCM.
            All data in transit is encrypted via TLS 1.2+.
          </p>

          <h3 className="font-bold text-[#2a2520] mt-4 mb-2">5.2 International Data Transfers</h3>
          <p>
            If you are located outside the United States, your data is transferred to the US for processing.
            For users in the EEA, UK, or Switzerland, we rely on Standard Contractual Clauses (SCCs) approved
            by the European Commission as the lawful transfer mechanism under GDPR Articles 44&ndash;49. For users
            in Brazil, we comply with LGPD Article 33 transfer requirements.
          </p>
          <p className="mt-3">Data is transferred to the following locations:</p>
          <ul className="list-disc pl-6 space-y-2 mt-2">
            <li><strong>United States</strong> &mdash; primary hosting and route execution</li>
            <li><strong>United States</strong> &mdash; Anthropic Claude API (AI processing, Odin tier only via Mj&ouml;lnir, one-time setup)</li>
            <li><strong>Global edge network</strong> &mdash; Cloudflare CDN for static marketing assets only (no personal data)</li>
          </ul>

          <h3 className="font-bold text-[#2a2520] mt-4 mb-2">5.3 Security Measures</h3>
          <p>
            We implement technical and organizational security measures including: AES-256-GCM encryption at rest,
            TLS 1.2+ for data in transit, role-based access controls, audit logging of administrative actions,
            and regular security reviews. Access to production systems is restricted to authorized personnel.
          </p>
        </section>

        <section>
          <h2 className="font-headline text-xl font-bold text-[#2a2520] mb-3">6. Sub-Processors &amp; Third-Party Services</h2>
          <p>We use the following sub-processors:</p>
          <div className="mt-3 space-y-4">
            <div className="p-4 bg-slate-50 border border-slate-200">
              <p className="font-bold text-[#2a2520] text-sm">Anthropic (Claude API) &mdash; AI Sub-Processor</p>
              <p className="text-sm mt-1">
                Purpose: AI-powered blueprint generation (Odin tier only, via Mj&ouml;lnir). Data shared: first 50 rows of
                uploaded BEFORE/AFTER files during one-time setup. A Data Processing Agreement (DPA) governs
                this relationship. Anthropic does not store request data beyond the duration of the API call
                and does not use customer data for model training under their commercial API terms. Data
                processed in the United States.
              </p>
            </div>
            <div className="p-4 bg-slate-50 border border-slate-200">
              <p className="font-bold text-[#2a2520] text-sm">Google &amp; Microsoft &mdash; Authentication Providers</p>
              <p className="text-sm mt-1">
                Purpose: OAuth for user authentication. Data shared: receives authentication requests.
                The identity provider supplies your name, email, and profile picture to us. Governed by each
                provider&apos;s respective privacy policy and terms of service.
              </p>
            </div>
            <div className="p-4 bg-slate-50 border border-slate-200">
              <p className="font-bold text-[#2a2520] text-sm">Cloudflare &mdash; CDN &amp; Asset Delivery</p>
              <p className="text-sm mt-1">
                Purpose: Content delivery network for static marketing assets (images, fonts). No personal data
                or route data is transmitted through Cloudflare.
              </p>
            </div>
          </div>
          <p className="mt-3 text-sm">
            We will notify users of material changes to our sub-processor list by updating this policy and
            posting the change date.
          </p>
        </section>

        <section>
          <h2 className="font-headline text-xl font-bold text-[#2a2520] mb-3">7. Your Rights</h2>
          <p>Depending on your location, you have the following rights regarding your personal data:</p>

          <h3 className="font-bold text-[#2a2520] mt-4 mb-2">7.1 All Users</h3>
          <ul className="list-disc pl-6 space-y-2 mt-2">
            <li><strong>Access</strong> &mdash; view your personal data via your account profile and route configurations</li>
            <li><strong>Correction</strong> &mdash; update inaccurate information through your account settings</li>
            <li><strong>Deletion</strong> &mdash; request deletion of your account and all associated data (completed within 30 days)</li>
            <li><strong>Export / Portability</strong> &mdash; export your route configurations, blueprint data, and personal data in a machine-readable format (JSON)</li>
            <li><strong>Revoke OAuth</strong> &mdash; disconnect identity provider access at any time through your Google or Microsoft account settings</li>
          </ul>

          <h3 className="font-bold text-[#2a2520] mt-4 mb-2">7.2 EEA/UK/Swiss Users (GDPR)</h3>
          <ul className="list-disc pl-6 space-y-2 mt-2">
            <li><strong>Restrict Processing</strong> (Art. 18) &mdash; request that we limit how we process your data in certain circumstances</li>
            <li><strong>Object to Processing</strong> (Art. 21) &mdash; object to processing based on legitimate interest, including usage analytics</li>
            <li><strong>Withdraw Consent</strong> (Art. 7(3)) &mdash; withdraw consent for AI processing at any time by discontinuing use of Mj&ouml;lnir; this does not affect the lawfulness of prior processing</li>
            <li><strong>Automated Decision-Making</strong> (Art. 22) &mdash; Hermod does not make automated decisions that produce legal effects concerning you; AI is used for blueprint generation which requires your explicit review and approval before deployment</li>
            <li><strong>Supervisory Authority Complaint</strong> (Art. 77) &mdash; you have the right to lodge a complaint with your local data protection authority if you believe your rights have been violated</li>
          </ul>

          <h3 className="font-bold text-[#2a2520] mt-4 mb-2">7.3 California Residents (CCPA/CPRA)</h3>
          <ul className="list-disc pl-6 space-y-2 mt-2">
            <li><strong>Right to Know</strong> &mdash; request disclosure of the categories and specific pieces of personal information we collect</li>
            <li><strong>Right to Delete</strong> &mdash; request deletion of your personal information</li>
            <li><strong>Right to Correct</strong> &mdash; request correction of inaccurate personal information</li>
            <li><strong>Right to Opt-Out of Sale/Sharing</strong> &mdash; Hermod does not sell or share (as defined by CPRA) your personal information for cross-context behavioral advertising. No opt-out mechanism is required because no sale or sharing occurs.</li>
            <li><strong>Right to Limit Sensitive PI Use</strong> &mdash; connection credentials are classified as sensitive personal information and are used solely for route execution</li>
            <li><strong>Authorized Agents</strong> &mdash; you may designate an authorized agent to submit requests on your behalf by providing written authorization to <span className="font-mono text-[#a06800]">privacy@hermodforge.com</span></li>
            <li><strong>Non-Discrimination</strong> &mdash; we will not discriminate against you for exercising your CCPA rights</li>
          </ul>

          <h3 className="font-bold text-[#2a2520] mt-4 mb-2">7.4 Brazilian Users (LGPD)</h3>
          <ul className="list-disc pl-6 space-y-2 mt-2">
            <li><strong>Anonymization</strong> &mdash; request anonymization of unnecessary or excessive personal data</li>
            <li><strong>Information about Sharing</strong> &mdash; request information about which entities your data has been shared with (see Section 6)</li>
            <li><strong>Revoke Consent</strong> &mdash; revoke consent for AI processing at any time</li>
          </ul>

          <p className="mt-4">
            To exercise any of these rights, contact <span className="font-mono text-[#a06800]">privacy@hermodforge.com</span>.
            We will respond to all verifiable requests within 30 days (or as required by applicable law).
          </p>
        </section>

        <section>
          <h2 id="data-retention-heading" className="font-headline text-xl font-bold text-[#2a2520] mb-3">8. Data Retention</h2>
          <div className="mt-3 overflow-x-auto">
            <table className="w-full text-sm border border-slate-200" aria-labelledby="data-retention-heading">
              <thead>
                <tr className="bg-slate-50">
                  <th className="text-left p-3 font-bold text-[#2a2520] border-b border-slate-200">Data Category</th>
                  <th className="text-left p-3 font-bold text-[#2a2520] border-b border-slate-200">Retention Period</th>
                </tr>
              </thead>
              <tbody>
                <tr><td className="p-3 border-b border-slate-100">Account information</td><td className="p-3 border-b border-slate-100">Duration of account + 30 days after deletion</td></tr>
                <tr className="bg-slate-50/50"><td className="p-3 border-b border-slate-100">Connection credentials</td><td className="p-3 border-b border-slate-100">Duration of account (deleted immediately on account deletion)</td></tr>
                <tr><td className="p-3 border-b border-slate-100">Route execution logs</td><td className="p-3 border-b border-slate-100">90 days</td></tr>
                <tr className="bg-slate-50/50"><td className="p-3 border-b border-slate-100">Error recovery queue</td><td className="p-3 border-b border-slate-100">Until recovered or 30 days max</td></tr>
                <tr><td className="p-3 border-b border-slate-100">Blueprint versions</td><td className="p-3 border-b border-slate-100">Most recent 50 + locked versions</td></tr>
                <tr className="bg-slate-50/50"><td className="p-3">Route payload data</td><td className="p-3">Not stored &mdash; in-memory only</td></tr>
              </tbody>
            </table>
          </div>
        </section>

        <section>
          <h2 className="font-headline text-xl font-bold text-[#2a2520] mb-3">9. Security Incidents &amp; Breach Notification</h2>
          <p>In the event of a personal data breach likely to risk your rights and freedoms, we will:</p>
          <ul className="list-disc pl-6 space-y-2 mt-3">
            <li>Notify the relevant supervisory authority within <strong>72 hours</strong> of becoming aware of the breach (GDPR Art. 33)</li>
            <li>Notify affected users <strong>without undue delay</strong> if the breach poses high risk to their rights (GDPR Art. 34)</li>
            <li>Provide details including: nature of data affected, approximate number of individuals impacted, likely consequences, and measures taken to mitigate</li>
            <li>Cooperate with authorities and affected users throughout investigation and remediation</li>
          </ul>
          <p className="mt-3">
            We maintain an internal incident response plan including containment, investigation, notification,
            and remediation procedures, reviewed annually.
          </p>
        </section>

        <section>
          <h2 className="font-headline text-xl font-bold text-[#2a2520] mb-3">10. Do Not Sell or Share My Personal Information</h2>
          <p>
            Hermod does not sell your personal information as defined by the CCPA. Hermod does not share your
            personal information for cross-context behavioral advertising as defined by the CPRA. We do not
            engage in data brokerage. If our practices change, we will update this policy and provide the
            required opt-out mechanism.
          </p>
        </section>

        <section>
          <h2 className="font-headline text-xl font-bold text-[#2a2520] mb-3">11. Cookies</h2>
          <p>
            Hermod uses a single session cookie to maintain your authenticated session. This is a strictly
            necessary cookie required for the service to function. We do not use tracking, advertising,
            or third-party analytics cookies.
          </p>
        </section>

        <section>
          <h2 className="font-headline text-xl font-bold text-[#2a2520] mb-3">12. Regulated &amp; Sensitive Data Disclaimer</h2>
          <p>
            Hermod is a general-purpose automated data delivery platform. It is <strong>not designed or certified</strong> for
            processing data subject to HIPAA (protected health information), PCI DSS (payment card data),
            or ITAR (export-controlled data) without additional agreements. If your routes process
            regulated data, contact us to discuss appropriate safeguards.
          </p>
        </section>

        <section>
          <h2 className="font-headline text-xl font-bold text-[#2a2520] mb-3">13. Children&rsquo;s Privacy</h2>
          <p>
            Hermod is a B2B service not directed at individuals under 16 (or under 13 where COPPA applies).
            We do not knowingly collect personal information from children. If we discover such collection,
            we will delete the data promptly.
          </p>
        </section>

        <section>
          <h2 className="font-headline text-xl font-bold text-[#2a2520] mb-3">14. Changes to This Policy</h2>
          <p>
            We may update this Privacy Policy from time to time. We will notify you of material changes by
            posting the updated policy, updating the &ldquo;Last updated&rdquo; date, and sending email
            notification for changes affecting your rights. Continued use after posting constitutes acceptance.
          </p>
        </section>

        <section>
          <h2 className="font-headline text-xl font-bold text-[#2a2520] mb-3">15. Contact Us</h2>
          <p>For questions, data rights requests, or security concerns:</p>
          <div className="mt-3 p-4 bg-slate-50 border border-slate-200 text-sm">
            <p><strong>Email:</strong> <span className="font-mono text-[#a06800]">privacy@hermodforge.com</span></p>
            <p><strong>Mail:</strong> Hermod Software LLC, [MAILING ADDRESS], United States</p>
          </div>
          <p className="mt-3 text-sm">
            EEA/UK users may also contact their local data protection authority. A list of EU DPAs is
            available at{" "}
            <a href="https://edpb.europa.eu/about-edpb/about-edpb/members_en" className="text-[#a06800] underline hover:text-amber-900" target="_blank" rel="noopener noreferrer">
              edpb.europa.eu
            </a>.
          </p>
        </section>

      </div>
    </article>
  );
}
