type CloseIconProps = {
  muted?: boolean;
  className?: string;
};

export default function CloseIcon({ muted = false, className = "" }: CloseIconProps) {
  return (
    <span
      className={`ui-close-icon ${muted ? "is-muted" : ""} ${className}`.trim()}
      aria-hidden="true"
    >
      &times;
    </span>
  );
}
