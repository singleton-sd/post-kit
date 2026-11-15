import React, { useEffect, useState } from 'react';

import { MenuItem, TextField } from '@mui/material';

import { FONT_FAMILIES } from '../../../../../../documents/blocks/helpers/fontFamily';

/** Select sentinel for "Match email settings" — emit `null`, never this string. */
export const FONT_FAMILY_INHERIT_VALUE = 'inherit';

/** Map a select string value to the document font family (`null` = inherit). */
export function fontFamilySelectValueToEmit(v: string): string | null {
  return v === FONT_FAMILY_INHERIT_VALUE ? null : v;
}

const OPTIONS = FONT_FAMILIES.map((option) => (
  <MenuItem key={option.key} value={option.key} sx={{ fontFamily: option.value }}>
    {option.label}
  </MenuItem>
));

type NullableProps = {
  label: string;
  onChange: (value: null | string) => void;
  defaultValue: null | string;
};
export function NullableFontFamily({ label, onChange, defaultValue }: NullableProps) {
  const [value, setValue] = useState(defaultValue ?? FONT_FAMILY_INHERIT_VALUE);
  useEffect(() => {
    setValue(defaultValue ?? FONT_FAMILY_INHERIT_VALUE);
  }, [defaultValue]);
  return (
    <TextField
      select
      variant="standard"
      label={label}
      value={value}
      onChange={(ev) => {
        const v = ev.target.value;
        setValue(v);
        onChange(fontFamilySelectValueToEmit(v));
      }}
    >
      <MenuItem value={FONT_FAMILY_INHERIT_VALUE}>Match email settings</MenuItem>
      {OPTIONS}
    </TextField>
  );
}
