/**
 * Admin email template — dark Norse aesthetic with technical details.
 * Used for report administrators/data engineers who want execution metadata.
 */
export const ADMIN_TEMPLATE = `<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml" lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<meta http-equiv="X-UA-Compatible" content="IE=edge">
<title>Hermod — Report Delivered</title>
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
  body { height: 100% !important; margin: 0 !important; padding: 0 !important; width: 100% !important; background-color: #0a0b0f; }
  @import url('https://fonts.googleapis.com/css2?family=Cinzel:wght@400;500;600;700;800;900&family=Cormorant+Garamond:ital,wght@0,300;0,400;0,500;0,600;1,400&family=JetBrains+Mono:wght@300;400;500&display=swap');
  @keyframes shimmer {
    0% { background-position: -200% center; }
    100% { background-position: 200% center; }
  }
  @keyframes runeGlow {
    0%, 100% { opacity: 0.4; text-shadow: 0 0 8px rgba(212,175,55,0.3); }
    50% { opacity: 1; text-shadow: 0 0 20px rgba(212,175,55,0.8), 0 0 40px rgba(212,175,55,0.3); }
  }
  @keyframes bifrostShift {
    0% { background-position: 0% 50%; }
    50% { background-position: 100% 50%; }
    100% { background-position: 0% 50%; }
  }
  .rune-float { animation: runeGlow 4s ease-in-out infinite; }
  .rune-float-delay { animation: runeGlow 4s ease-in-out infinite; animation-delay: 1.3s; }
  .rune-float-delay2 { animation: runeGlow 4s ease-in-out infinite; animation-delay: 2.6s; }
  @media (prefers-color-scheme: dark) {
    .dark-bg { background-color: #0a0b0f !important; }
  }
  @media only screen and (max-width: 600px) {
    .mobile-full { width: 100% !important; }
    .mobile-padding { padding-left: 20px !important; padding-right: 20px !important; }
    .mobile-title { font-size: 36px !important; letter-spacing: 10px !important; }
    .mobile-hide { display: none !important; }
    .mobile-stack { display: block !important; width: 100% !important; }
    .stat-cell { display: block !important; width: 100% !important; padding-bottom: 16px !important; }
  }
</style>
</head>
<body style="margin:0; padding:0; background-color:#0a0b0f; -webkit-font-smoothing:antialiased;">
<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="background-color:#0a0b0f;">
<tr><td align="center" style="padding: 0;">

<!-- BIFROST TOP BAR -->
<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="max-width:680px;">
<tr><td style="height:4px; background: linear-gradient(90deg, #ff6b6b, #ffa726, #ffee58, #66bb6a, #42a5f5, #7e57c2, #ff6b6b); background-size: 200% 100%; animation: bifrostShift 6s ease infinite;">&nbsp;</td></tr>
</table>

<!-- MAIN CONTAINER -->
<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="max-width:680px; background-color:#0d0e14;" class="mobile-full">

  <!-- HEADER -->
  <tr><td style="padding: 48px 40px 24px 40px; text-align: center;" class="mobile-padding">
    <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%">
    <tr>
      <td style="text-align: left; font-size: 18px; color: #d4af37; opacity: 0.3; font-family: serif;" class="rune-float">\u16BA</td>
      <td style="text-align: center;">
        <table role="presentation" cellpadding="0" cellspacing="0" border="0" align="center">
        <tr><td style="width: 56px; height: 56px; text-align: center; vertical-align: middle; font-size: 28px; color: #d4af37; border: 1px solid rgba(212,175,55,0.25); border-radius: 2px; background: linear-gradient(135deg, rgba(212,175,55,0.08) 0%, transparent 100%); font-family: serif;">\u27E1</td></tr>
        </table>
      </td>
      <td style="text-align: right; font-size: 18px; color: #d4af37; opacity: 0.3; font-family: serif;" class="rune-float-delay">\u16D7</td>
    </tr>
    </table>
    <p style="margin: 20px 0 0 0; font-family: 'Cinzel', 'Times New Roman', Georgia, serif; font-size: 13px; font-weight: 600; letter-spacing: 8px; text-transform: uppercase; color: #d4af37;">HERMOD</p>
    <table role="presentation" cellpadding="0" cellspacing="0" border="0" align="center" style="margin-top: 16px;">
    <tr>
      <td style="width: 60px; height: 1px; background: linear-gradient(90deg, transparent, rgba(212,175,55,0.4));"></td>
      <td style="padding: 0 12px; font-size: 10px; color: rgba(212,175,55,0.5); font-family: serif;">\u16CA</td>
      <td style="width: 60px; height: 1px; background: linear-gradient(90deg, rgba(212,175,55,0.4), transparent);"></td>
    </tr>
    </table>
  </td></tr>

  <!-- HERO -->
  <tr><td style="padding: 16px 40px 40px 40px; text-align: center;" class="mobile-padding">
    <table role="presentation" cellpadding="0" cellspacing="0" border="0" align="center" style="margin-bottom: 24px;">
    <tr><td style="padding: 6px 20px; border: 1px solid rgba(102,187,106,0.3); border-radius: 24px; background: rgba(102,187,106,0.06);">
      <span style="font-family: 'JetBrains Mono', 'Courier New', monospace; font-size: 11px; font-weight: 500; letter-spacing: 3px; text-transform: uppercase; color: #66bb6a;">\u2726 DELIVERY COMPLETE</span>
    </td></tr>
    </table>
    <h1 style="margin: 0 0 16px 0; font-family: 'Cinzel', 'Times New Roman', Georgia, serif; font-size: 44px; font-weight: 700; letter-spacing: 14px; text-transform: uppercase; color: #e8e0d0; line-height: 1.1; text-shadow: 0 2px 30px rgba(212,175,55,0.15);" class="mobile-title">YOUR<br>REPORT<br>AWAITS</h1>
    <p style="margin: 0; font-family: 'Cormorant Garamond', Georgia, 'Times New Roman', serif; font-size: 18px; font-style: italic; font-weight: 300; color: rgba(232,224,208,0.5); letter-spacing: 1px;">Forged in data. Delivered across realms.</p>
  </td></tr>

  <!-- REPORT DETAILS CARD -->
  <tr><td style="padding: 0 40px 32px 40px;" class="mobile-padding">
    <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="background: linear-gradient(180deg, rgba(212,175,55,0.04) 0%, rgba(13,14,20,0) 100%); border: 1px solid rgba(212,175,55,0.12); border-radius: 4px;">
      <tr><td style="padding: 28px 32px 20px 32px; border-bottom: 1px solid rgba(212,175,55,0.08);">
        <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%">
        <tr>
          <td>
            <p style="margin:0 0 4px 0; font-family:'JetBrains Mono','Courier New',monospace; font-size:10px; letter-spacing:3px; text-transform:uppercase; color:rgba(212,175,55,0.5);">REPORT</p>
            <p style="margin:0; font-family:'Cinzel','Times New Roman',Georgia,serif; font-size:20px; font-weight:600; color:#e8e0d0; letter-spacing:2px;">{{REPORT_NAME}}</p>
          </td>
          <td style="text-align:right; vertical-align:top;">
            <span style="font-size:28px; color:rgba(212,175,55,0.3); font-family:serif;" class="rune-float-delay2">\u16A0</span>
          </td>
        </tr>
        </table>
      </td></tr>
      <tr><td style="padding: 24px 32px;">
        <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%">
          <tr>
            <td style="padding-bottom:20px; width:50%;" class="stat-cell" valign="top">
              <p style="margin:0 0 4px 0; font-family:'JetBrains Mono','Courier New',monospace; font-size:9px; letter-spacing:2.5px; text-transform:uppercase; color:rgba(212,175,55,0.4);">\u27D0 CLIENT</p>
              <p style="margin:0; font-family:'Cormorant Garamond',Georgia,serif; font-size:16px; font-weight:500; color:#c4b998;">{{CLIENT_NAME}}</p>
            </td>
            <td style="padding-bottom:20px; width:50%;" class="stat-cell" valign="top">
              <p style="margin:0 0 4px 0; font-family:'JetBrains Mono','Courier New',monospace; font-size:9px; letter-spacing:2.5px; text-transform:uppercase; color:rgba(212,175,55,0.4);">\u27D0 DATASOURCE</p>
              <p style="margin:0; font-family:'Cormorant Garamond',Georgia,serif; font-size:16px; font-weight:500; color:#c4b998;">{{DATASOURCE}}</p>
            </td>
          </tr>
          <tr>
            <td style="padding-bottom:20px; width:50%;" class="stat-cell" valign="top">
              <p style="margin:0 0 4px 0; font-family:'JetBrains Mono','Courier New',monospace; font-size:9px; letter-spacing:2.5px; text-transform:uppercase; color:rgba(212,175,55,0.4);">\u27D0 EXECUTED</p>
              <p style="margin:0; font-family:'Cormorant Garamond',Georgia,serif; font-size:16px; font-weight:500; color:#c4b998;">{{EXECUTION_DATE}}</p>
            </td>
            <td style="padding-bottom:20px; width:50%;" class="stat-cell" valign="top">
              <p style="margin:0 0 4px 0; font-family:'JetBrains Mono','Courier New',monospace; font-size:9px; letter-spacing:2.5px; text-transform:uppercase; color:rgba(212,175,55,0.4);">\u27D0 FORGE TIME</p>
              <p style="margin:0; font-family:'Cormorant Garamond',Georgia,serif; font-size:16px; font-weight:500; color:#c4b998;">{{DURATION}}</p>
            </td>
          </tr>
          <tr>
            <td style="width:50%;" class="stat-cell" valign="top">
              <p style="margin:0 0 4px 0; font-family:'JetBrains Mono','Courier New',monospace; font-size:9px; letter-spacing:2.5px; text-transform:uppercase; color:rgba(212,175,55,0.4);">\u27D0 ROWS FORGED</p>
              <p style="margin:0; font-family:'Cinzel','Times New Roman',Georgia,serif; font-size:26px; font-weight:700; color:#d4af37; letter-spacing:2px;">{{ROW_COUNT}}</p>
            </td>
            <td style="width:50%;" class="stat-cell" valign="top">
              <p style="margin:0 0 4px 0; font-family:'JetBrains Mono','Courier New',monospace; font-size:9px; letter-spacing:2.5px; text-transform:uppercase; color:rgba(212,175,55,0.4);">\u27D0 SHEETS</p>
              <p style="margin:0; font-family:'Cinzel','Times New Roman',Georgia,serif; font-size:26px; font-weight:700; color:#d4af37; letter-spacing:2px;">{{SHEET_COUNT}}</p>
            </td>
          </tr>
        </table>
      </td></tr>
    </table>
  </td></tr>

  <!-- ATTACHMENT -->
  <tr><td style="padding: 0 40px 32px 40px;" class="mobile-padding">
    <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="background: rgba(212,175,55,0.03); border: 1px dashed rgba(212,175,55,0.15); border-radius: 4px;">
      <tr>
        <td style="padding: 20px 24px;" width="48" valign="middle">
          <table role="presentation" cellpadding="0" cellspacing="0" border="0">
          <tr><td style="width:44px; height:44px; text-align:center; vertical-align:middle; background: rgba(102,187,106,0.08); border: 1px solid rgba(102,187,106,0.15); border-radius: 3px; font-family: 'JetBrains Mono','Courier New',monospace; font-size: 11px; font-weight: 600; color: #66bb6a; letter-spacing: 1px;">.xlsx</td></tr>
          </table>
        </td>
        <td style="padding: 20px 24px 20px 8px;" valign="middle">
          <p style="margin:0 0 2px 0; font-family:'Cormorant Garamond',Georgia,serif; font-size:16px; font-weight:600; color:#e8e0d0;">{{FILENAME}}</p>
          <p style="margin:0; font-family:'JetBrains Mono','Courier New',monospace; font-size:11px; color:rgba(232,224,208,0.35);">{{FILE_SIZE}} \u00B7 attached below</p>
        </td>
        <td style="padding: 20px 24px; text-align:right;" valign="middle" class="mobile-hide">
          <span style="font-family:'JetBrains Mono','Courier New',monospace; font-size:10px; letter-spacing:2px; color:rgba(102,187,106,0.5);">\u25BC ATTACHED</span>
        </td>
      </tr>
    </table>
  </td></tr>

  <!-- QUERY PREVIEW -->
  <tr><td style="padding: 0 40px 32px 40px;" class="mobile-padding">
    <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="margin-bottom:12px;">
    <tr>
      <td style="width: 30px; height: 1px; background: rgba(212,175,55,0.15); vertical-align: middle;"></td>
      <td style="padding: 0 10px;">
        <span style="font-family:'JetBrains Mono','Courier New',monospace; font-size:9px; letter-spacing:3px; text-transform:uppercase; color:rgba(212,175,55,0.35);">THE INCANTATION</span>
      </td>
      <td style="height: 1px; background: rgba(212,175,55,0.08); vertical-align: middle;"></td>
    </tr>
    </table>
    <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="background: #08090c; border: 1px solid rgba(212,175,55,0.06); border-radius: 4px; border-left: 3px solid rgba(212,175,55,0.25);">
    <tr><td style="padding: 20px 24px;">
      <p style="margin: 0; font-family: 'JetBrains Mono', 'Courier New', monospace; font-size: 12px; line-height: 1.8; color: rgba(232,224,208,0.4); white-space: pre-wrap; word-break: break-all;">{{SQL_PREVIEW}}</p>
    </td></tr>
    </table>
  </td></tr>

  <!-- NEXT SCHEDULED RUN -->
  <tr><td style="padding: 0 40px 40px 40px; text-align:center;" class="mobile-padding">
    <table role="presentation" cellpadding="0" cellspacing="0" border="0" align="center">
    <tr><td style="padding: 10px 28px; border: 1px solid rgba(212,175,55,0.1); border-radius: 3px; background: rgba(212,175,55,0.02);">
      <p style="margin:0; font-family:'JetBrains Mono','Courier New',monospace; font-size:10px; color:rgba(232,224,208,0.3); letter-spacing:2px;">
        NEXT RIDE \u219D <span style="color:rgba(212,175,55,0.6);">{{NEXT_SCHEDULE}}</span>
      </p>
    </td></tr>
    </table>
  </td></tr>

  <!-- RUNIC DIVIDER -->
  <tr><td style="padding: 0 40px 32px 40px;" class="mobile-padding">
    <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%">
    <tr><td style="height:1px; background: linear-gradient(90deg, transparent, rgba(212,175,55,0.12), transparent);"></td></tr>
    <tr><td style="text-align:center; padding-top:8px;">
      <span style="font-family:serif; font-size:14px; color:rgba(212,175,55,0.15); letter-spacing:18px;">\u16BA \u16CA \u16B1 \u16D7 \u16A0 \u16CF</span>
    </td></tr>
    </table>
  </td></tr>

  <!-- FOOTER -->
  <tr><td style="padding: 0 40px 40px 40px; text-align:center;" class="mobile-padding">
    <p style="margin: 0 0 8px 0; font-family: 'Cinzel', 'Times New Roman', Georgia, serif; font-size: 11px; font-weight: 500; letter-spacing: 5px; text-transform: uppercase; color: rgba(212,175,55,0.3);">\u27E1 HERMOD</p>
    <p style="margin: 0 0 16px 0; font-family: 'Cormorant Garamond', Georgia, serif; font-size: 13px; font-style: italic; color: rgba(232,224,208,0.2);">Swift as Sleipnir \u00B7 Sharp as Odin\u2019s Ravens</p>
    <p style="margin: 0 0 4px 0; font-family: 'JetBrains Mono', 'Courier New', monospace; font-size: 10px; color: rgba(232,224,208,0.12); letter-spacing: 1px;">This report was automatically generated and delivered by Hermod v{{VERSION}}</p>
    <p style="margin: 0; font-family: 'JetBrains Mono', 'Courier New', monospace; font-size: 10px; color: rgba(232,224,208,0.12); letter-spacing: 1px;">Managed by {{MANAGED_BY}}</p>
  </td></tr>

</table>

<!-- BIFROST BOTTOM BAR -->
<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="max-width:680px;">
<tr><td style="height:4px; background: linear-gradient(90deg, #7e57c2, #42a5f5, #66bb6a, #ffee58, #ffa726, #ff6b6b, #7e57c2); background-size: 200% 100%; animation: bifrostShift 6s ease infinite;">&nbsp;</td></tr>
</table>

<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%">
<tr><td style="height:40px;">&nbsp;</td></tr>
</table>

</td></tr>
</table>
</body>
</html>`;
