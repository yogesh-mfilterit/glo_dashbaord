export interface MenuItem {
  name: string;
  path: string;
  adminOnly?: boolean;
  disabled?: boolean;
  cpPath?: string;
  cpHidden?: boolean;
}

export const menuItems: MenuItem[] = [
  { name: 'Content Partners', path: '/content-partners' },
  { name: 'ServiceIds', path: '/service-ids' },
  { name: 'Service Descriptions', path: '/service-descriptions' },
  { name: 'Custom UI-Zip', path: '/service-zip' },
   { name: 'CP Console', path: '/cp-console', adminOnly: true },  
  // { name: "CP Onboard Approval", path: "/cpOnboardApproval", adminOnly: true },
  { name: 'Manage Users', path: '/users', adminOnly: true },
  { name: 'Check Transaction', path: '/check-mfid' },
  { name: 'Summary', path: '/new-summary' },
  { name: 'Callback Update', path: '/callbackUpdate', adminOnly: true },
  { name: 'Un-Subscribed', path: '/unsubscribed', adminOnly: true },

  { name: 'Activity Logs', path: '/activity-logs', adminOnly: true },
  // { name: "Download Reports", path: "/download-reports", cpPath: "/cp-download-reports", cpHidden: true },
];
