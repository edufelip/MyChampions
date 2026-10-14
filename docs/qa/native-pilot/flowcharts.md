# Native pilot source flowcharts

Generated with `generate-native-declaration.py`. Every node and edge is declared only; local runtime receipts are not imported into this portable graph. These diagrams are not test results. The overview retains recovery candidates and the iOS credential-save setup branch outside the five core baseline paths.

## Overview

```mermaid
flowchart TD
  SCR_pro_home["Professional home / source only"]
  STATE_password_save["iOS credential-save prompt / source only"]
  SCR_sign_in["Email sign-in / source only"]
  SCR_account["Account settings / source only"]
  STATE_signout_confirm["Sign-out confirmation / source only"]
  SCR_training_library["Professional training library / source only"]
  SCR_training_builder["Training builder / source only"]
  STATE_session_editor["Add session form / source only"]
  STATE_exercise_search["Exercise search sheet / source only"]
  STATE_exercise_detail["Exercise detail and quantity / source only"]
  STATE_native_text_edit_menu["Native text selection menu / source only"]
  STATE_item_removal_confirm["Exercise removal confirmation / source only"]
  STATE_training_save_error["Failed save with retained draft / source only"]
  STATE_training_load_error["Builder load error / source only"]
  STATE_discard_confirm["Unsaved draft discard / source only"]
  SCR_student_home["Student home / source only"]
  SCR_student_professionals["Student relationships / source only"]
  STATE_connection_pending["Student pending confirmation / source only"]
  SCR_pro_pending["Professional pending requests / source only"]
  SCR_pro_roster["Professional roster / source only"]
  STATE_connection_active["Student active assignment / source only"]
  STATE_camera_prompt["OS camera prompt / source only"]
  STATE_camera_guidance["Camera denied or unavailable guidance / source only"]
  SCR_pro_home -. "iOS offers credential saving after normal sign-in / external" .-> STATE_password_save
  STATE_password_save -. "Decline using the iOS Not Now control / external" .-> SCR_pro_home
  SCR_sign_in -. "Sign in as seeded coach / guarded" .-> SCR_pro_home
  SCR_pro_home -. "Terminate/relaunch; restore locked role session / guarded" .-> SCR_pro_home
  SCR_pro_home -. "Open account tab / normal" .-> SCR_account
  SCR_account -. "Choose sign out / normal" .-> STATE_signout_confirm
  STATE_signout_confirm -. "Cancel sign out / normal" .-> SCR_account
  STATE_signout_confirm -. "Confirm sign out; relaunch remains signed out / guarded" .-> SCR_sign_in
  SCR_pro_home -. "Open training tab / normal" .-> SCR_training_library
  SCR_training_library -. "Create local plan draft / normal" .-> SCR_training_builder
  SCR_training_builder -. "Add first session / normal" .-> STATE_session_editor
  STATE_session_editor -. "Confirm named session without backend write / normal" .-> SCR_training_builder
  SCR_training_builder -. "Search local catalog / normal" .-> STATE_exercise_search
  STATE_exercise_search -. "Choose exact catalog exercise ID / normal" .-> STATE_exercise_detail
  STATE_exercise_detail -. "Confirm quantity and notes into draft / normal" .-> SCR_training_builder
  SCR_training_builder -. "Save draft through normal server route / normal" .-> SCR_training_library
  SCR_training_builder -. "Open normal native text selection / external" .-> STATE_native_text_edit_menu
  STATE_native_text_edit_menu -. "Select all and clear the editable title / normal" .-> SCR_training_builder
  SCR_training_builder -. "Select entire editable title with normal paragraph gesture / external" .-> SCR_training_builder
  SCR_training_builder -. "Backspace selected title and require entirely empty value / guarded" .-> SCR_training_builder
  SCR_training_builder -. "Request exercise item removal / guarded" .-> STATE_item_removal_confirm
  STATE_item_removal_confirm -. "Confirm local exercise removal / guarded" .-> SCR_training_builder
  SCR_training_library -. "Reopen and edit owned plan / normal" .-> SCR_training_builder
  SCR_training_library -. "Relaunch/reopen persisted exact values / guarded" .-> SCR_training_builder
  SCR_training_builder -. "Save with one private pre-forward rejection / error" .-> STATE_training_save_error
  STATE_training_save_error -. "Remove fault and retry retained draft / normal" .-> SCR_training_library
  SCR_training_library -. "Supported failed builder read / error" .-> STATE_training_load_error
  STATE_training_load_error -. "Retry recoverable read / normal" .-> SCR_training_builder
  SCR_training_builder -. "Leave dirty draft / guarded" .-> STATE_discard_confirm
  STATE_discard_confirm -. "Cancel discard / normal" .-> SCR_training_builder
  STATE_discard_confirm -. "Confirm discard / normal" .-> SCR_training_library
  SCR_sign_in -. "Sign in as seeded student / guarded" .-> SCR_student_home
  SCR_student_home -. "Open connections / normal" .-> SCR_student_professionals
  SCR_student_professionals -. "Submit live specialty code through UI / normal" .-> STATE_connection_pending
  STATE_connection_pending -. "Sign out/login coach and open pending queue / guarded" .-> SCR_pro_pending
  SCR_pro_pending -. "Coach confirms exact pending student / normal" .-> SCR_pro_roster
  SCR_pro_roster -. "Sign out/login student; verify active assignment / guarded" .-> STATE_connection_active
  SCR_student_professionals -. "Open scanner after camera permission reset / external" .-> STATE_camera_prompt
  STATE_camera_prompt -. "Deny using platform system permission control / external" .-> STATE_camera_guidance
  STATE_camera_guidance -. "Submit manual code after denial / normal" .-> STATE_connection_pending
```

## session

```mermaid
flowchart TD
  SCR_sign_in["Email sign-in / source only"]
  SCR_pro_home["Professional home / source only"]
  SCR_account["Account settings / source only"]
  STATE_signout_confirm["Sign-out confirmation / source only"]
  SCR_sign_in -. "Sign in as seeded coach / guarded" .-> SCR_pro_home
  SCR_pro_home -. "Terminate/relaunch; restore locked role session / guarded" .-> SCR_pro_home
  SCR_pro_home -. "Open account tab / normal" .-> SCR_account
  SCR_account -. "Choose sign out / normal" .-> STATE_signout_confirm
  STATE_signout_confirm -. "Confirm sign out; relaunch remains signed out / guarded" .-> SCR_sign_in
```

## training

```mermaid
flowchart TD
  SCR_pro_home["Professional home / source only"]
  SCR_training_library["Professional training library / source only"]
  SCR_training_builder["Training builder / source only"]
  STATE_session_editor["Add session form / source only"]
  STATE_exercise_search["Exercise search sheet / source only"]
  STATE_exercise_detail["Exercise detail and quantity / source only"]
  STATE_item_removal_confirm["Exercise removal confirmation / source only"]
  SCR_pro_home -. "Open training tab / normal" .-> SCR_training_library
  SCR_training_library -. "Create local plan draft / normal" .-> SCR_training_builder
  SCR_training_builder -. "Add first session / normal" .-> STATE_session_editor
  STATE_session_editor -. "Confirm named session without backend write / normal" .-> SCR_training_builder
  SCR_training_builder -. "Search local catalog / normal" .-> STATE_exercise_search
  STATE_exercise_search -. "Choose exact catalog exercise ID / normal" .-> STATE_exercise_detail
  STATE_exercise_detail -. "Confirm quantity and notes into draft / normal" .-> SCR_training_builder
  SCR_training_builder -. "Save draft through normal server route / normal" .-> SCR_training_library
  SCR_training_library -. "Reopen and edit owned plan / normal" .-> SCR_training_builder
  SCR_training_builder -. "Select entire editable title with normal paragraph gesture / external" .-> SCR_training_builder
  SCR_training_builder -. "Backspace selected title and require entirely empty value / guarded" .-> SCR_training_builder
  SCR_training_builder -. "Request exercise item removal / guarded" .-> STATE_item_removal_confirm
  STATE_item_removal_confirm -. "Confirm local exercise removal / guarded" .-> SCR_training_builder
  SCR_training_builder -. "Search local catalog / normal" .-> STATE_exercise_search
  STATE_exercise_search -. "Choose exact catalog exercise ID / normal" .-> STATE_exercise_detail
  STATE_exercise_detail -. "Confirm quantity and notes into draft / normal" .-> SCR_training_builder
  SCR_training_builder -. "Save draft through normal server route / normal" .-> SCR_training_library
  SCR_training_library -. "Relaunch/reopen persisted exact values / guarded" .-> SCR_training_builder
```

## connection

```mermaid
flowchart TD
  SCR_sign_in["Email sign-in / source only"]
  SCR_student_home["Student home / source only"]
  SCR_student_professionals["Student relationships / source only"]
  STATE_connection_pending["Student pending confirmation / source only"]
  SCR_pro_pending["Professional pending requests / source only"]
  SCR_pro_roster["Professional roster / source only"]
  STATE_connection_active["Student active assignment / source only"]
  SCR_sign_in -. "Sign in as seeded student / guarded" .-> SCR_student_home
  SCR_student_home -. "Open connections / normal" .-> SCR_student_professionals
  SCR_student_professionals -. "Submit live specialty code through UI / normal" .-> STATE_connection_pending
  STATE_connection_pending -. "Sign out/login coach and open pending queue / guarded" .-> SCR_pro_pending
  SCR_pro_pending -. "Coach confirms exact pending student / normal" .-> SCR_pro_roster
  SCR_pro_roster -. "Sign out/login student; verify active assignment / guarded" .-> STATE_connection_active
```

## camera-denied

```mermaid
flowchart TD
  SCR_sign_in["Email sign-in / source only"]
  SCR_student_home["Student home / source only"]
  SCR_student_professionals["Student relationships / source only"]
  STATE_camera_prompt["OS camera prompt / source only"]
  STATE_camera_guidance["Camera denied or unavailable guidance / source only"]
  STATE_connection_pending["Student pending confirmation / source only"]
  SCR_sign_in -. "Sign in as seeded student / guarded" .-> SCR_student_home
  SCR_student_home -. "Open connections / normal" .-> SCR_student_professionals
  SCR_student_professionals -. "Open scanner after camera permission reset / external" .-> STATE_camera_prompt
  STATE_camera_prompt -. "Deny using platform system permission control / external" .-> STATE_camera_guidance
  STATE_camera_guidance -. "Submit manual code after denial / normal" .-> STATE_connection_pending
```

## save-retry

```mermaid
flowchart TD
  SCR_pro_home["Professional home / source only"]
  SCR_training_library["Professional training library / source only"]
  SCR_training_builder["Training builder / source only"]
  STATE_session_editor["Add session form / source only"]
  STATE_exercise_search["Exercise search sheet / source only"]
  STATE_exercise_detail["Exercise detail and quantity / source only"]
  STATE_training_save_error["Failed save with retained draft / source only"]
  SCR_pro_home -. "Open training tab / normal" .-> SCR_training_library
  SCR_training_library -. "Create local plan draft / normal" .-> SCR_training_builder
  SCR_training_builder -. "Add first session / normal" .-> STATE_session_editor
  STATE_session_editor -. "Confirm named session without backend write / normal" .-> SCR_training_builder
  SCR_training_builder -. "Search local catalog / normal" .-> STATE_exercise_search
  STATE_exercise_search -. "Choose exact catalog exercise ID / normal" .-> STATE_exercise_detail
  STATE_exercise_detail -. "Confirm quantity and notes into draft / normal" .-> SCR_training_builder
  SCR_training_builder -. "Save with one private pre-forward rejection / error" .-> STATE_training_save_error
  STATE_training_save_error -. "Remove fault and retry retained draft / normal" .-> SCR_training_library
  SCR_training_library -. "Relaunch/reopen persisted exact values / guarded" .-> SCR_training_builder
```
