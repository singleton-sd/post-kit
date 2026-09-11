import React, { useEffect, useState } from 'react';

import { InputLabel, Stack, ToggleButtonGroup } from '@mui/material';

type Props = {
  label: string | JSX.Element;
  children: JSX.Element | JSX.Element[];
  defaultValue: string;
  onChange: (v: string) => void;
};
export default function RadioGroupInput({ label, children, defaultValue, onChange }: Props) {
  const [value, setValue] = useState(defaultValue);
  useEffect(() => {
    setValue(defaultValue);
  }, [defaultValue]);
  return (
    <Stack alignItems="flex-start">
      <InputLabel shrink>{label}</InputLabel>
      <ToggleButtonGroup
        exclusive
        fullWidth
        value={value}
        size="small"
        onChange={(_, v: unknown) => {
          // Exclusive ToggleButtonGroup emits null when the pressed button is toggled off.
          if (v === null || v === undefined || v === '') {
            return;
          }
          if (typeof v !== 'string') {
            throw new Error('RadioGroupInput can only receive string values');
          }
          setValue(v);
          onChange(v);
        }}
      >
        {children}
      </ToggleButtonGroup>
    </Stack>
  );
}
