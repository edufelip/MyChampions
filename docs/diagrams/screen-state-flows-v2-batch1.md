# Screen State Flows V2 (Batch 1)

## SC-217 Auth Sign-In
```mermaid
flowchart TD
  A[Open Sign-In] --> B[Idle Form]
  B --> C[Submit Email/Password]
  B --> D[Tap Google/Apple]
  C --> E{Valid Credentials?}
  D --> F{Provider Success?}
  E -->|No| G[Contextual Auth Error]
  F -->|No| H[Provider Error State]
  E -->|Yes| I[Authenticated Session]
  F -->|Yes| I
  I --> J{Role Locked?}
  J -->|No| K[Go To Role Selection]
  J -->|Yes| L[Redirect Role Home]
```

## SC-218 Auth Create Account
```mermaid
flowchart TD
  A[Open Create Account] --> B[Idle Form]
  B --> C[Enter Name Email Password Confirm]
  C --> D{Password Policy + Match + ASCII Special Char}
  D -->|No| E[Contextual Validation Errors]
  D -->|Yes| F{Email Unique?}
  F -->|No| G[Duplicate Email Error + Action]
  F -->|Yes| H[Create Account]
  H --> I[Authenticated Session]
  I --> J[Go To Role Selection]
```

## SC-201 Auth Role Selection
```mermaid
flowchart TD
  A[Open Role Selection] --> B{Role Already Locked?}
  B -->|Yes| C[Redirect Role Home]
  B -->|No| D[Show Student/Professional Options]
  D --> D1[Select Student + Continue]
  D1 --> D2[Commit Student Role]
  D2 --> H
  D --> E[Save Role]
  E --> F{Professional?}
  F -->|Yes| G[Professional Specialty Setup]
  F -->|No| H[Student Home]
```

## SC-202 Professional Specialty Setup
```mermaid
flowchart TD
  A[Open Specialty Screen] --> B[Select 1+ Specialties]
  B --> C[Optional professional_registry by specialty]
  C --> D{Remove Specialty?}
  D -->|No| E[Save]
  D -->|Yes| F{Has Active/Pending Students Or Last Specialty?}
  F -->|Yes| G[Block Removal + Show Assist Actions]
  G --> G1[View Active Students]
  G --> G2[Manage Pending Requests]
  F -->|No| E
  E --> H[Specialties Updated]
```

## SC-203 Student Home Dashboard
```mermaid
flowchart TD
  A[Load Student Home] --> B[Summary Loaded]
  B --> C[Show Pending Connection Status Prominently]
  C --> D[Nutrition Section]
  D --> D1[Hydration Card + Effective Goal + Streak]
  D1 --> E[Training Section]
  E --> F[Recipes + Settings Actions]
  B --> G{Offline?}
  G -->|Yes| H[Show Persistent Offline Banner + Read-Only Mode]
  H --> H1[Write Actions Show Lock Reason]
  H --> J{Last Sync > 24h?}
  J -->|Yes| K[Show Stale Indicator + Last Sync]
  J -->|No| L[No Stale Indicator]
  G -->|No| I[Normal Mode]
```

## SC-204 Professional Home Dashboard
```mermaid
flowchart TD
  A[Load Professional Home] --> B[Show Active Count + Pending Count]
  B --> B1[Pending Queue Search/Filter + Bulk Deny]
  B --> C[Invite Code Actions Text + QR]
  C --> D[Student Management Actions]
  D --> E{Entitlement Active?}
  E -->|Yes| F[Normal Write Actions]
  E -->|No + Over Cap| G[Lock New Activations + Plan Updates]
  E -->|Yes + Near Lapse| G1[Show Pre-Lapse Warning]
  B --> H[Bottom Nav: Dashboard Students Nutrition Training Account]
```

## SC-211 Relationship Management
```mermaid
flowchart TD
  A[Student Enters Invite Code] --> B{Professional Pending < 10?}
  A1[Student Scans Invite QR] --> A2[Parse Invite Payload]
  A2 --> A3{Payload Valid?}
  A3 -->|No| C1[Contextual Invite Error]
  A3 -->|Yes| B
  B -->|No| C[Pending Cap Error]
  B -->|Yes| D[Pending Confirmation]
  X[Professional Regenerates Code] --> Y[Invalidate Old Code]
  Y --> Z[Auto-Cancel Pending From Old Code]
  Z --> Z1[Student Sees Canceled Reason + Reconnect CTA]
  D --> E[Professional Accepts Or Denies]
  E --> F{Accepted?}
  F -->|Yes| G[Active Assignment]
  F -->|No| H[Request Closed]
```

## SC-212 Professional Subscription Gate
```mermaid
flowchart TD
  A[Fetch Entitlement + Counts] --> B{Over Cap?}
  B -->|No| C[No Lock]
  B -->|Yes| D{Entitlement Active?}
  D -->|Yes| D1{Near Lapse?}
  D1 -->|Yes| D2[Show Pre-Lapse Warning]
  D1 -->|No| E[Unlocked]
  D2 --> E
  D -->|No| F[Lock Activations + Plan Updates]
  F --> G[Purchase/Restore Flow]
  G --> E
```

## SC-205 Student Roster Pending Queue
```mermaid
flowchart TD
  A[Open Students Screen] --> B[Active + Pending Tabs]
  B --> C[Search/Filter Pending Queue]
  C --> D[Select One Or More Pending Requests]
  D --> E[Bulk Deny Confirmation]
  E --> F[Requests Denied + Counters Updated]
  B --> G[Select Multiple Active Students]
  G --> H[Start Bulk Plan Assignment]
```

## SC-207/SC-208 Starter Template Flow
```mermaid
flowchart TD
  A[Open Plan Builder] --> B[Template Library]
  B --> C[Select Starter Template]
  C --> D[Clone Starter To Draft]
  D --> E[Customize Draft]
  E --> F[Save Named Predefined Plan]
  F --> G[Bulk Assign To Multiple Students]
  G --> H[Fine-Tune Each Student Draft]
  H --> I[Confirm Assignments]
```

## SC-209 Hydration Tracking
```mermaid
flowchart TD
  A[Open Nutrition Today] --> B[Load Effective Water Goal]
  B --> C{Nutritionist Goal Override Active?}
  C -->|Yes| D[Use Nutritionist Goal]
  C -->|No| E[Use Student Personal Goal]
  D --> F[Log Water Intake]
  E --> F
  F --> G[Update Completion + Streak]
```

## SC-214 Recipe Image Upload
```mermaid
flowchart TD
  A[Select Recipe Image] --> B[Compress + Validate Limits]
  B --> C[Upload Progress Visible]
  C --> D{Upload Success?}
  D -->|Yes| E[Attach Image To Meal Draft]
  D -->|No| F[Show Failure Reason + Retry]
  F --> G[Retry Upload]
  G --> C
```
