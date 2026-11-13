import React, { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { fetchProtectedBlobUrl, openProtectedFile } from '../../utils/protectedFile';

/** Loads a protected upload into a blob: URL for as long as the component is mounted. */
function useProtectedSrc(src?: string | null) {
  const [url, setUrl] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let cancelled = false;
    let created: string | null = null;
    setUrl(null);
    setFailed(false);
    if (!src) return undefined;
    fetchProtectedBlobUrl(src)
      .then((u) => {
        if (cancelled) {
          if (u.startsWith('blob:')) URL.revokeObjectURL(u);
          return;
        }
        if (u.startsWith('blob:')) created = u;
        setUrl(u);
      })
      .catch(() => !cancelled && setFailed(true));
    return () => {
      cancelled = true;
      if (created) URL.revokeObjectURL(created);
    };
  }, [src]);
  return { url, failed };
}

type ImgProps = Omit<React.ImgHTMLAttributes<HTMLImageElement>, 'src'> & { src?: string | null };

export function ProtectedImage({ src, alt = '', className, ...rest }: ImgProps) {
  const { url, failed } = useProtectedSrc(src);
  if (failed) return <p className="mt-2 text-xs text-muted-foreground">File could not be loaded.</p>;
  if (!url) return <div className={className} style={{ minHeight: '3rem' }} aria-busy="true" />;
  return <img src={url} alt={alt} className={className} {...rest} />;
}

type VideoProps = Omit<React.VideoHTMLAttributes<HTMLVideoElement>, 'src'> & { src?: string | null };

export function ProtectedVideo({ src, className, ...rest }: VideoProps) {
  const { url, failed } = useProtectedSrc(src);
  if (failed) return <p className="mt-2 text-xs text-muted-foreground">File could not be loaded.</p>;
  if (!url) return <div className={className} style={{ minHeight: '3rem' }} aria-busy="true" />;
  return <video src={url} className={className} {...rest} />;
}

type LinkProps = Omit<React.AnchorHTMLAttributes<HTMLAnchorElement>, 'href'> & { href?: string | null };

/** Drop-in for <a href={uploadUrl} target="_blank"> pointing at a protected upload. */
export function ProtectedLink({ href, children, onClick, target: _target, rel: _rel, ...rest }: LinkProps) {
  return (
    <a
      href={href || '#'}
      {...rest}
      onClick={(e) => {
        onClick?.(e);
        if (e.defaultPrevented || !href) return;
        e.preventDefault();
        openProtectedFile(href).catch(() => toast.error('You do not have access to this file, or it could not be loaded.'));
      }}
    >
      {children}
    </a>
  );
}
