"""
Email notifications via Resend.

Three message types:
  - Real-time solar surplus alert
  - Daily report digest
  - Weekly report with Claude AI narrative
"""

import logging
import os

import resend

logger = logging.getLogger(__name__)


def _init():
    resend.api_key = os.environ["RESEND_API_KEY"]


def _send(subject: str, html: str) -> None:
    _init()
    params = {
        "from": os.environ["RESEND_FROM_EMAIL"],
        "to": [os.environ["REPORT_RECIPIENT_EMAIL"]],
        "subject": subject,
        "html": html,
    }
    resp = resend.Emails.send(params)
    logger.info("Email sent: subject=%r id=%s", subject, resp.get("id"))


# --- Templates ---

ALERT_TEMPLATE = """\
<div style="font-family: -apple-system, sans-serif; max-width: 600px; margin: 0 auto;">
  <div style="background: #f59e0b; color: white; padding: 16px 24px; border-radius: 8px 8px 0 0;">
    <h2 style="margin: 0;">⚡ WattWise Alert</h2>
  </div>
  <div style="background: #fffbeb; padding: 24px; border: 1px solid #f59e0b; border-top: none; border-radius: 0 0 8px 8px;">
    <p style="font-size: 16px; line-height: 1.6; margin: 0;">{message}</p>
  </div>
</div>
"""

DAILY_TEMPLATE = """\
<div style="font-family: -apple-system, sans-serif; max-width: 600px; margin: 0 auto;">
  <div style="background: #2563eb; color: white; padding: 16px 24px; border-radius: 8px 8px 0 0;">
    <h2 style="margin: 0;">📊 Daily Energy Report — {date}</h2>
  </div>
  <div style="background: #f8fafc; padding: 24px; border: 1px solid #e2e8f0; border-top: none; border-radius: 0 0 8px 8px;">
    {actions_section}
    <div style="margin-bottom: 20px;">
      <h3 style="color: #334155; margin: 0 0 8px;">Context</h3>
      <p style="font-size: 15px; line-height: 1.6; color: #475569; margin: 0;">{context}</p>
    </div>
    <div>
      <h3 style="color: #334155; margin: 0 0 12px;">Numbers</h3>
      <table style="width: 100%; border-collapse: collapse; font-size: 14px;">
        <tr style="border-bottom: 1px solid #e2e8f0;">
          <td style="padding: 8px 0; color: #64748b;">Grid Import</td>
          <td style="padding: 8px 0; text-align: right; font-weight: 600;">{total_import_kwh:.1f} kWh — ${total_cost:.2f}</td>
        </tr>
        <tr style="border-bottom: 1px solid #e2e8f0;">
          <td style="padding: 8px 0; color: #64748b;">  Peak</td>
          <td style="padding: 8px 0; text-align: right;">{peak_kwh:.1f} kWh — ${peak_cost:.2f}</td>
        </tr>
        <tr style="border-bottom: 1px solid #e2e8f0;">
          <td style="padding: 8px 0; color: #64748b;">  Part Peak</td>
          <td style="padding: 8px 0; text-align: right;">{part_peak_kwh:.1f} kWh — ${part_peak_cost:.2f}</td>
        </tr>
        <tr style="border-bottom: 1px solid #e2e8f0;">
          <td style="padding: 8px 0; color: #64748b;">  Off Peak</td>
          <td style="padding: 8px 0; text-align: right;">{off_peak_kwh:.1f} kWh — ${off_peak_cost:.2f}</td>
        </tr>
        <tr style="border-bottom: 1px solid #e2e8f0;">
          <td style="padding: 8px 0; color: #64748b;">EV Charging</td>
          <td style="padding: 8px 0; text-align: right;">{ev_kwh:.1f} kWh — ${ev_cost:.2f}</td>
        </tr>
        <tr style="border-bottom: 1px solid #e2e8f0;">
          <td style="padding: 8px 0; color: #64748b;">Powerwall Peak Coverage</td>
          <td style="padding: 8px 0; text-align: right;">{battery_coverage:.0f}%</td>
        </tr>
        <tr style="border-bottom: 1px solid #e2e8f0;">
          <td style="padding: 8px 0; color: #64748b;">Solar Generated</td>
          <td style="padding: 8px 0; text-align: right;">{solar_generated_kwh:.1f} kWh</td>
        </tr>
        <tr style="border-bottom: 1px solid #e2e8f0;">
          <td style="padding: 8px 0; color: #64748b;">Solar Self-Consumed</td>
          <td style="padding: 8px 0; text-align: right;">{solar_self_consumed_kwh:.1f} kWh</td>
        </tr>
        <tr style="border-bottom: 1px solid #e2e8f0;">
          <td style="padding: 8px 0; color: #64748b;">Solar Exported</td>
          <td style="padding: 8px 0; text-align: right;">{solar_exported_kwh:.1f} kWh — ${export_credit:.2f} credit</td>
        </tr>
        <tr>
          <td style="padding: 8px 0; color: #64748b;">Month-to-Date</td>
          <td style="padding: 8px 0; text-align: right; font-weight: 600;">${mtd_cost:.2f} {mtd_vs_prior}</td>
        </tr>
      </table>
    </div>
  </div>
</div>
"""

WEEKLY_TEMPLATE = """\
<div style="font-family: -apple-system, sans-serif; max-width: 600px; margin: 0 auto;">
  <div style="background: #7c3aed; color: white; padding: 16px 24px; border-radius: 8px 8px 0 0;">
    <h2 style="margin: 0;">📈 Weekly Energy Report — {week_label}</h2>
  </div>
  <div style="background: #f8fafc; padding: 24px; border: 1px solid #e2e8f0; border-top: none; border-radius: 0 0 8px 8px;">
    {actions_section}
    <div style="margin-bottom: 20px;">
      <h3 style="color: #334155; margin: 0 0 8px;">This Week</h3>
      <p style="font-size: 15px; line-height: 1.6; color: #475569; margin: 0;">{ai_narrative}</p>
    </div>
    <div>
      <h3 style="color: #334155; margin: 0 0 12px;">Numbers</h3>
      <table style="width: 100%; border-collapse: collapse; font-size: 14px;">
        <tr style="border-bottom: 1px solid #e2e8f0;">
          <td style="padding: 8px 0; color: #64748b;">Grid Import</td>
          <td style="padding: 8px 0; text-align: right; font-weight: 600;">{total_import_kwh:.1f} kWh — ${total_cost:.2f}</td>
        </tr>
        <tr style="border-bottom: 1px solid #e2e8f0;">
          <td style="padding: 8px 0; color: #64748b;">  Peak</td>
          <td style="padding: 8px 0; text-align: right;">{peak_kwh:.1f} kWh — ${peak_cost:.2f}</td>
        </tr>
        <tr style="border-bottom: 1px solid #e2e8f0;">
          <td style="padding: 8px 0; color: #64748b;">  Off Peak</td>
          <td style="padding: 8px 0; text-align: right;">{off_peak_kwh:.1f} kWh — ${off_peak_cost:.2f}</td>
        </tr>
        <tr style="border-bottom: 1px solid #e2e8f0;">
          <td style="padding: 8px 0; color: #64748b;">EV Charging</td>
          <td style="padding: 8px 0; text-align: right;">{ev_kwh:.1f} kWh — ${ev_cost:.2f}</td>
        </tr>
        <tr style="border-bottom: 1px solid #e2e8f0;">
          <td style="padding: 8px 0; color: #64748b;">Powerwall Peak Coverage</td>
          <td style="padding: 8px 0; text-align: right;">{battery_coverage:.0f}%</td>
        </tr>
        <tr style="border-bottom: 1px solid #e2e8f0;">
          <td style="padding: 8px 0; color: #64748b;">Solar Generated</td>
          <td style="padding: 8px 0; text-align: right;">{solar_generated_kwh:.1f} kWh</td>
        </tr>
        <tr style="border-bottom: 1px solid #e2e8f0;">
          <td style="padding: 8px 0; color: #64748b;">Solar Self-Consumed / Exported</td>
          <td style="padding: 8px 0; text-align: right;">{solar_self_consumed_kwh:.1f} / {solar_exported_kwh:.1f} kWh</td>
        </tr>
        <tr>
          <td style="padding: 8px 0; color: #64748b;">Week-over-Week</td>
          <td style="padding: 8px 0; text-align: right; font-weight: 600;">${total_cost:.2f} {wow_change}</td>
        </tr>
      </table>
    </div>
  </div>
</div>
"""


def _format_actions(actions: list[str] | None) -> str:
    if not actions:
        return ""
    items = "".join(
        f'<li style="margin-bottom: 6px; color: #b91c1c;">{a}</li>'
        for a in actions
    )
    return (
        '<div style="margin-bottom: 20px;">'
        '<h3 style="color: #dc2626; margin: 0 0 8px;">🔴 Actions</h3>'
        f'<ul style="margin: 0; padding-left: 20px;">{items}</ul>'
        "</div>"
    )


# --- Public API ---


async def send_alert(subject: str, message: str) -> None:
    html = ALERT_TEMPLATE.format(message=message)
    _send(subject, html)


async def send_daily_report(data: dict) -> None:
    data["actions_section"] = _format_actions(data.get("actions"))
    data.setdefault("mtd_vs_prior", "")
    html = DAILY_TEMPLATE.format(**data)
    subject = f"WattWise Daily — {data['date']}"
    _send(subject, html)


async def send_weekly_report(data: dict) -> None:
    data["actions_section"] = _format_actions(data.get("actions"))
    data.setdefault("wow_change", "")
    html = WEEKLY_TEMPLATE.format(**data)
    subject = f"WattWise Weekly — {data['week_label']}"
    _send(subject, html)
