export interface MenuItem {
  name: string;
  path: string;
  icon: string;
  section?: string;
  adminOnly?: boolean;
  disabled?: boolean;
  cpPath?: string;
  cpHidden?: boolean;
}

export const menuItems: MenuItem[] = [
  {
    name: "Content Partners",
    path: "/content-partners",
    icon: "users",
    section: "Workspace",
  },
  {
    name: "ServiceIds",
    path: "/service-ids",
    icon: "fingerprint",
    section: "Workspace",
  },
  {
    name: "Service Descriptions",
    path: "/service-descriptions",
    icon: "file-text",
    section: "Workspace",
  },
  {
    name: "Custom UI-Zip",
    path: "/service-zip",
    icon: "package",
    section: "Workspace",
  },
  {
    name: "Check Transaction",
    path: "/check-mfid",
    icon: "receipt",
    section: "Operations",
  },
  {
    name: "Summary",
    path: "/new-summary",
    icon: "chart-no-axes-combined",
    section: "Operations",
  },
  {
    name: "Manage Users",
    path: "/users",
    icon: "user-cog",
    section: "Administration",
    adminOnly: true,
  },
  {
    name: "Callback Update",
    path: "/callbackUpdate",
    icon: "refresh-cw",
    section: "Administration",
    adminOnly: true,
  },
  {
    name: "Un-Subscribed",
    path: "/unsubscribed",
    icon: "user-minus",
    section: "Administration",
    adminOnly: true,
  },
  {
    name: "Activity Logs",
    path: "/activity-logs",
    icon: "history",
    section: "Administration",
    adminOnly: true,
  },
  // {
  //   name: "Download Reports",
  //   path: "/download-reports",
  //   icon: "download",
  //   section: "Reports",
  //   cpPath: "/cp-download-reports",
  //   cpHidden: true,
  // },
];