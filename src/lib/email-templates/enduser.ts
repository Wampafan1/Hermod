/**
 * End-user email template — light, professional, warm parchment aesthetic.
 * Used for business recipients who receive the report attachment.
 */
export const ENDUSER_TEMPLATE = `<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml" lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<meta http-equiv="X-UA-Compatible" content="IE=edge">
<title>Your Report Is Ready</title>
<!--[if mso]>
<noscript>
<xml>
<o:OfficeDocumentSettings>
<o:PixelsPerInch>96</o:PixelsPerInch>
</o:OfficeDocumentSettings>
</xml>
</noscript>
<![endif]-->
<style type="text/css">
  body, table, td, a { -webkit-text-size-adjust: 100%; -ms-text-size-adjust: 100%; }
  table, td { mso-table-lspace: 0pt; mso-table-rspace: 0pt; }
  img { -ms-interpolation-mode: bicubic; border: 0; height: auto; line-height: 100%; outline: none; text-decoration: none; }
  body { height: 100% !important; margin: 0 !important; padding: 0 !important; width: 100% !important; background-color: #f4f1ec; }
  @import url('https://fonts.googleapis.com/css2?family=Cinzel:wght@400;500;600;700&family=EB+Garamond:ital,wght@0,400;0,500;0,600;1,400&family=DM+Sans:wght@300;400;500&display=swap');
  @keyframes bifrostShift {
    0% { background-position: 0% 50%; }
    100% { background-position: 200% 50%; }
  }
  @media only screen and (max-width: 600px) {
    .mobile-full { width: 100% !important; }
    .mobile-padding { padding-left: 24px !important; padding-right: 24px !important; }
    .mobile-title { font-size: 28px !important; letter-spacing: 6px !important; }
  }
</style>
</head>
<body style="margin:0; padding:0; background-color:#f4f1ec; -webkit-font-smoothing:antialiased;">
<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" class="outer-wrap-bg" style="background-color:#f4f1ec;">
<tr><td align="center" style="padding: 32px 16px;">

<!-- BIFROST ACCENT -->
<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="max-width:560px;">
<tr><td style="height:3px; border-radius:3px 3px 0 0; background: linear-gradient(90deg, #e8998d, #e6b86a, #c9d4a0, #8ec5c0, #9db4d4, #b8a0cb); background-size: 200% 100%; animation: bifrostShift 8s linear infinite;">&nbsp;</td></tr>
</table>

<!-- MAIN CARD -->
<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" class="card-bg card-border mobile-full" style="max-width:560px; background-color:#ffffff; border: 1px solid rgba(0,0,0,0.06); border-top: none; border-radius: 0 0 8px 8px;">

  <!-- HEADER -->
  <tr><td style="padding: 40px 44px 28px 44px; text-align: center;" class="mobile-padding">
    <!--BRANDING_START--><p style="margin: 0 0 24px 0; font-family: 'Cinzel', Georgia, 'Times New Roman', serif; font-size: 12px; font-weight: 600; letter-spacing: 6px; text-transform: uppercase; color: #5c4a20;">\u27E1 HERMOD</p><!--BRANDING_END-->
    <h1 class="light-text mobile-title" style="margin: 0 0 12px 0; font-family: 'Cinzel', Georgia, 'Times New Roman', serif; font-size: 32px; font-weight: 600; letter-spacing: 8px; color: #2a2520; line-height: 1.2;">YOUR REPORT<br>IS READY</h1>
    <table role="presentation" cellpadding="0" cellspacing="0" border="0" align="center" style="margin: 16px auto 20px;">
    <tr>
      <td style="width: 40px; height: 1px; background: linear-gradient(90deg, transparent, #7a6530);"></td>
      <td style="padding: 0 10px;"><span style="font-family: serif; font-size: 10px; color: #7a6530;">\u2726</span></td>
      <td style="width: 40px; height: 1px; background: linear-gradient(90deg, #7a6530, transparent);"></td>
    </tr>
    </table>
    <p class="dim-text" style="margin: 0; font-family: 'DM Sans', 'Helvetica Neue', Arial, sans-serif; font-size: 15px; color: #3a3530; line-height: 1.6;">The following report has been generated and is attached to this email.</p>
  </td></tr>

  <!-- REPORT INFO -->
  <tr><td style="padding: 0 44px 28px 44px;" class="mobile-padding">
    <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="background: #faf8f4; border: 1px solid rgba(0,0,0,0.04); border-radius: 6px;">
      <tr><td style="padding: 28px 28px 24px 28px;">
        <p style="margin:0 0 4px 0; font-family:'DM Sans','Helvetica Neue',Arial,sans-serif; font-size:11px; font-weight:500; letter-spacing:2px; text-transform:uppercase; color:#5c4a20;">Report</p>
        <p class="light-text" style="margin:0 0 20px 0; font-family:'Cinzel',Georgia,serif; font-size:19px; font-weight:600; color:#2a2520; letter-spacing:1px; line-height:1.4;">{{REPORT_NAME}}</p>
        <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%">
        <tr><td class="divider-line" style="height:1px; background:#eee8dc;"></td></tr>
        </table>
        <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="margin-top:18px;">
        <tr>
          <td style="width:50%;" valign="top">
            <p style="margin:0 0 3px 0; font-family:'DM Sans','Helvetica Neue',Arial,sans-serif; font-size:11px; font-weight:500; letter-spacing:2px; text-transform:uppercase; color:#5c4a20;">Date</p>
            <p class="dim-text" style="margin:0; font-family:'EB Garamond',Georgia,serif; font-size:16px; color:#3a3530;">{{REPORT_DATE}}</p>
          </td>
          <td style="width:50%;" valign="top">
            <p style="margin:0 0 3px 0; font-family:'DM Sans','Helvetica Neue',Arial,sans-serif; font-size:11px; font-weight:500; letter-spacing:2px; text-transform:uppercase; color:#5c4a20;">Prepared For</p>
            <p class="dim-text" style="margin:0; font-family:'EB Garamond',Georgia,serif; font-size:16px; color:#3a3530;">{{RECIPIENT_NAME}}</p>
          </td>
        </tr>
        </table>
      </td></tr>
    </table>
  </td></tr>

  <!-- ATTACHMENT -->
  <tr><td style="padding: 0 44px 32px 44px;" class="mobile-padding">
    <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" class="attach-bg" style="background: #f5f9f5; border: 1px solid rgba(102,187,106,0.15); border-radius: 6px;">
      <tr>
        <td style="padding: 18px 20px;" width="48" valign="middle">
          <table role="presentation" cellpadding="0" cellspacing="0" border="0">
          <tr><td class="attach-icon-bg" style="width: 42px; height: 42px; text-align: center; vertical-align: middle; background: rgba(102,187,106,0.08); border: 1px solid rgba(102,187,106,0.12); border-radius: 6px; font-family: 'DM Sans','Helvetica Neue',Arial,sans-serif; font-size: 10px; font-weight: 600; color: #4caf50; letter-spacing: 0.5px;">.xlsx</td></tr>
          </table>
        </td>
        <td style="padding: 18px 20px 18px 8px;" valign="middle">
          <p class="light-text" style="margin:0 0 2px 0; font-family:'DM Sans','Helvetica Neue',Arial,sans-serif; font-size:14px; font-weight:500; color:#2a2520;">{{FILENAME}}</p>
          <p class="ghost-text" style="margin:0; font-family:'DM Sans','Helvetica Neue',Arial,sans-serif; font-size:12px; color:#4a4238;">{{FILE_SIZE}} \u00B7 Attached below</p>
        </td>
      </tr>
    </table>
  </td></tr>

  <!-- CUSTOM MESSAGE (conditionally included) -->
  {{CUSTOM_MESSAGE_BLOCK}}

  <!-- NEXT DELIVERY -->
  <tr><td style="padding: 0 44px 36px 44px; text-align: center;" class="mobile-padding">
    <p class="ghost-text" style="margin: 0; font-family: 'DM Sans', 'Helvetica Neue', Arial, sans-serif; font-size: 12px; color: #b8a89a; letter-spacing: 0.5px;">Next delivery: <span style="color:#3a3530;">{{NEXT_SCHEDULE}}</span></p>
  </td></tr>

  <!-- FOOTER -->
  <tr><td style="padding: 0 44px 32px 44px; text-align: center;" class="mobile-padding">
    <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="margin-bottom: 20px;">
    <tr><td class="divider-line" style="height: 1px; background: linear-gradient(90deg, transparent, #a89060, transparent);"></td></tr>
    </table>
    <!--BRANDING_START--><p style="margin: 0 0 4px 0; font-family: 'Cinzel', Georgia, serif; font-size: 10px; font-weight: 500; letter-spacing: 5px; color: #c9bca6;">\u27E1 HERMOD</p>
    <p style="margin: 0 0 12px 0; font-family: 'EB Garamond', Georgia, serif; font-size: 12px; font-style: italic; color: #cdc3b3;">Automated Report Delivery</p><!--BRANDING_END-->
    <!--POWERED_BY_START--><p style="margin: 0; font-family: 'DM Sans', 'Helvetica Neue', Arial, sans-serif; font-size: 11px; color: #d5cdbf;">Powered by Hermod</p><!--POWERED_BY_END-->
  </td></tr>

</table>

<!-- BIFROST BOTTOM ACCENT -->
<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="max-width:560px;">
<tr><td style="height:3px; border-radius:0 0 3px 3px; background: linear-gradient(90deg, #b8a0cb, #9db4d4, #8ec5c0, #c9d4a0, #e6b86a, #e8998d); background-size: 200% 100%; animation: bifrostShift 8s linear infinite;">&nbsp;</td></tr>
</table>

</td></tr>
</table>
</body>
</html>`;

/** The custom message block that gets inserted when a message is provided */
export const CUSTOM_MESSAGE_BLOCK = `<tr><td style="padding: 0 44px 28px 44px;" class="mobile-padding">
    <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%">
    <tr>
      <td style="border-left: 2px solid #7a6530; padding-left: 16px;">
        <p style="margin:0 0 4px 0; font-family:'DM Sans',Arial,sans-serif; font-size:11px; font-weight:500; letter-spacing:2px; text-transform:uppercase; color:#5c4a20;">Note</p>
        <p style="margin:0; font-family:'EB Garamond',Georgia,serif; font-size:15px; font-style:italic; color:#2a2520; line-height:1.7;">{{CUSTOM_MESSAGE}}</p>
      </td>
    </tr>
    </table>
  </td></tr>`;
