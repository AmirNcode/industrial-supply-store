import { ForgetShownOnce } from "./ForgetShownOnce";
import { ShareButton } from "./ShareButton";

/**
 * A just-issued sign-in, shown once. The message is the whole hand-over — the
 * address, the login and the temporary password in one piece of text — so the
 * person reading it never has to assemble it from three places.
 */
export function ShownOnceCredential({
  heading,
  loginLabel,
  login,
  password,
  message,
  labels,
}: {
  heading: string;
  loginLabel: string;
  login: string;
  password: string;
  message: string;
  labels: { tempPassword: string; share: string; copied: string };
}) {
  return (
    <div
      role="status"
      className="mb-3 border-2 border-[var(--color-warn)] bg-[var(--color-warn-soft)] p-3 text-[12px]"
    >
      <p className="mb-2 font-bold">{heading}</p>
      <dl className="mb-2 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1">
        <dt className="font-bold">{loginLabel}</dt>
        <dd className="tech" dir="ltr" data-testid="shown-once-login">
          {login}
        </dd>
        <dt className="font-bold">{labels.tempPassword}</dt>
        <dd className="tech" dir="ltr" data-testid="shown-once-password">
          {password}
        </dd>
      </dl>
      <ShareButton text={message} label={labels.share} copiedLabel={labels.copied} />
      <ForgetShownOnce />
    </div>
  );
}
