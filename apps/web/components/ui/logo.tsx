'use client';



export function Logo() {
  return (
    <>
    {/* eslint-disable-next-line @next/next/no-img-element */}
    <img
      className="brand-logo brand-logo-light"
      src="/brand/tripdock-logo.png"
      width="1863"
      height="844"
      alt="TripDock"
    />
    <span
      className="brand-logo brand-logo-dark"
      role="img"
      aria-label="TripDock"
    />
    </>
  );
}
