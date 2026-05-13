import os
import smtplib
from email.message import EmailMessage

def send_email(subject: str, content: str, to_email: str = None):
    smtp_host = os.getenv("SMTP_HOST")
    smtp_port = int(os.getenv("SMTP_PORT", 587))
    smtp_user = os.getenv("SMTP_USER")
    smtp_pass = os.getenv("SMTP_PASS")
    smtp_from = os.getenv("SMTP_FROM", "noreply@klipperfarm.local")

    if not all([smtp_host, smtp_user, smtp_pass]):
        print("SMTP not configured. Skipping email.")
        return False

    if to_email is None:
        to_email = smtp_user

    msg = EmailMessage()
    msg.set_content(content)
    msg['Subject'] = f"[Klipper Farm] {subject}"
    msg['From'] = smtp_from
    msg['To'] = to_email

    try:
        with smtplib.SMTP(smtp_host, smtp_port) as server:
            server.starttls()
            server.login(smtp_user, smtp_pass)
            server.send_message(msg)
        return True
    except Exception as e:
        print(f"Failed to send email: {e}")
        return False
