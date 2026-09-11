import React, { useEffect, useState } from 'react';

import { AddOutlined } from '@mui/icons-material';
import { IconButton } from '@mui/material';

type Props = {
  buttonElement: HTMLElement | null;
  onClick: () => void;
};
export default function DividerButton({ buttonElement, onClick }: Props) {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    function listener({ clientX, clientY }: MouseEvent) {
      if (!buttonElement) {
        return;
      }
      const rect = buttonElement.getBoundingClientRect();
      const rectY = rect.y;
      const bottomX = rect.x;
      const topX = bottomX + rect.width;

      if (Math.abs(clientY - rectY) < 20) {
        if (bottomX < clientX && clientX < topX) {
          setVisible(true);
          return;
        }
      }
      setVisible(false);
    }
    window.addEventListener('mousemove', listener);
    return () => {
      window.removeEventListener('mousemove', listener);
    };
  }, [buttonElement, setVisible]);

  return (
    <IconButton
      aria-label="Add block"
      size="small"
      tabIndex={0}
      sx={{
        p: 0.12,
        position: 'absolute',
        top: '-12px',
        left: '50%',
        transform: 'translateX(-10px)',
        bgcolor: 'brand.blue',
        color: 'primary.contrastText',
        zIndex: 'fab',
        // Stay focusable when visually hidden; reveal on pointer hover or keyboard focus.
        opacity: visible ? 1 : 0,
        '&:focus-visible': {
          opacity: 1,
        },
        '&:hover, &:active, &:focus': {
          bgcolor: 'brand.blue',
          color: 'primary.contrastText',
        },
      }}
      onClick={(ev) => {
        ev.stopPropagation();
        onClick();
      }}
    >
      <AddOutlined fontSize="small" />
    </IconButton>
  );
}
