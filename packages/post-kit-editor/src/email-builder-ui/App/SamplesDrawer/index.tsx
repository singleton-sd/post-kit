import React from 'react';

import { Drawer, Stack, Typography } from '@mui/material';

import { useSamplesDrawerOpen } from '../../documents/editor/EditorContext';

import SidebarButton from './SidebarButton';

export const SAMPLES_DRAWER_WIDTH = 240;

export default function SamplesDrawer() {
  const samplesDrawerOpen = useSamplesDrawerOpen();

  return (
    <Drawer
      variant="persistent"
      anchor="left"
      open={samplesDrawerOpen}
      sx={{
        width: samplesDrawerOpen ? SAMPLES_DRAWER_WIDTH : 0,
      }}
    >
      <Stack spacing={3} py={1} px={2} width={SAMPLES_DRAWER_WIDTH} height="100%">
        <Stack
          spacing={2}
          sx={{ '& .MuiButtonBase-root': { width: '100%', justifyContent: 'flex-start' } }}
        >
          <Typography variant="h6" component="h1" sx={{ p: 0.75 }}>
            Samples
          </Typography>

          <Stack alignItems="flex-start">
            <SidebarButton sampleHash="#">Empty</SidebarButton>
            <SidebarButton sampleHash="#sample/welcome">Welcome email</SidebarButton>
            <SidebarButton sampleHash="#sample/one-time-password">
              One-time passcode (OTP)
            </SidebarButton>
            <SidebarButton sampleHash="#sample/reset-password">Reset password</SidebarButton>
            <SidebarButton sampleHash="#sample/order-ecomerce">E-commerce receipt</SidebarButton>
            <SidebarButton sampleHash="#sample/subscription-receipt">
              Subscription receipt
            </SidebarButton>
            <SidebarButton sampleHash="#sample/reservation-reminder">
              Reservation reminder
            </SidebarButton>
            <SidebarButton sampleHash="#sample/post-metrics-report">Post metrics</SidebarButton>
            <SidebarButton sampleHash="#sample/respond-to-message">
              Respond to inquiry
            </SidebarButton>
          </Stack>
        </Stack>
      </Stack>
    </Drawer>
  );
}
