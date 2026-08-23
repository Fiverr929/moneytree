type CloseIconProps = {
  muted?: boolean;
  className?: string;
};

export default function CloseIcon({ muted = false, className = "" }: CloseIconProps) {
  return (
    <img
      className={`ui-close-icon ${className}`.trim()}
      src={muted ? "/assets/icon-x-inactive.svg" : "/assets/icon-x-active.svg"}
      alt=""
      aria-hidden="true"
    />
  );
}
