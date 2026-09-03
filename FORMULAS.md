# Roll-up formulas — BOM Procurement moved to last

Stage order is now: **Schematic → PCB Layout → SI & PI → Bare-PCB Fab → Assembly → Bring-up → BOM Procurement**

Column map these formulas assume (the ACTIVE layout):

| Stage | Owner | Status | Target |
|---|---|---|---|
| S1 Schematic | L | **M** | N |
| S2 PCB Layout | O | **P** | Q |
| S3 SI & PI | R | **S** | T |
| S4 Bare-PCB Fab | U | **V** | W |
| S5 Assembly | X | **Y** | Z |
| S6 Bring-up | AA | **AB** | AC |
| S7 BOM Procurement | AD | **AE** | AF |

Paste into row 17 on ACTIVE (row 6 on COMPLETED), then fill down.

---

## E — Current Stage

The first stage that is not Completed, NA or Cancelled.

```
=IF(NOT(OR(M17="Completed",M17="NA",M17="Cancelled")),"S1 Schematic",IF(NOT(OR(P17="Completed",P17="NA",P17="Cancelled")),"S2 PCB Layout",IF(NOT(OR(S17="Completed",S17="NA",S17="Cancelled")),"S3 SI & PI",IF(NOT(OR(V17="Completed",V17="NA",V17="Cancelled")),"S4 Bare-PCB Fab",IF(NOT(OR(Y17="Completed",Y17="NA",Y17="Cancelled")),"S5 Assembly",IF(NOT(OR(AB17="Completed",AB17="NA",AB17="Cancelled")),"S6 Bring-up",IF(NOT(OR(AE17="Completed",AE17="NA",AE17="Cancelled")),"S7 BOM Procurement","All Stages Closed")))))))
```

## F — Overall Status

The status at the current stage, or Completed once every stage is closed. Any cancelled stage cancels the board.

```
=IF(COUNTIF(M17,"Cancelled")+COUNTIF(P17,"Cancelled")+COUNTIF(S17,"Cancelled")+COUNTIF(V17,"Cancelled")+COUNTIF(Y17,"Cancelled")+COUNTIF(AB17,"Cancelled")+COUNTIF(AE17,"Cancelled")>0,"Cancelled",IF(E17="All Stages Closed","Completed",IF(E17="S1 Schematic",M17,IF(E17="S2 PCB Layout",P17,IF(E17="S3 SI & PI",S17,IF(E17="S4 Bare-PCB Fab",V17,IF(E17="S5 Assembly",Y17,IF(E17="S6 Bring-up",AB17,AE17))))))))
```

## G — Target (current stage), showing "Not added"

Pulls the due date of whichever stage the board is at. Where no date has been entered it says **Not added** instead of sitting blank.

```
=IF(E17="All Stages Closed","",IF(E17="S1 Schematic",IF(N17="","Not added",N17),IF(E17="S2 PCB Layout",IF(Q17="","Not added",Q17),IF(E17="S3 SI & PI",IF(T17="","Not added",T17),IF(E17="S4 Bare-PCB Fab",IF(W17="","Not added",W17),IF(E17="S5 Assembly",IF(Z17="","Not added",Z17),IF(E17="S6 Bring-up",IF(AC17="","Not added",AC17),IF(AF17="","Not added",AF17))))))))
```

Set the number format of column G to `DD-MMM-YY;;;@` — real dates render normally, the text shows through, zeros stay hidden.

## H — Delay (days)

```
=IF(OR(F17="Completed",F17="Cancelled"),"",IF(NOT(ISNUMBER(G17)),"Date not added",IF(TODAY()>G17,TODAY()-G17,"On time")))
```

`ISNUMBER` is what keeps this honest — without it, the text in G would compare as larger than any date and every undated board would report as overdue.

## I — Stages Done

```
=COUNTIF(M17,"Completed")+COUNTIF(P17,"Completed")+COUNTIF(S17,"Completed")+COUNTIF(V17,"Completed")+COUNTIF(Y17,"Completed")+COUNTIF(AB17,"Completed")+COUNTIF(AE17,"Completed")
```

## J — Stages In Scope

```
=7-(COUNTIF(M17,"NA")+COUNTIF(P17,"NA")+COUNTIF(S17,"NA")+COUNTIF(V17,"NA")+COUNTIF(Y17,"NA")+COUNTIF(AB17,"NA")+COUNTIF(AE17,"NA"))
```

## K — % Through Process

```
=IFERROR(I17/J17,"")
```

---

## Hold and delay reasons

**AK — Hold / delay reason.** A dropdown, filled by hand. Data → Data validation, range `AK17:AK241`, criteria: dropdown from a range, `LISTS!F2:F10`.

The list on `LISTS` column F:

```
Waiting on customer feedback
Waiting on component / long-lead part
De-prioritised for another board
Rework after SI/PI review
Waiting on updated schematic
Fab or assembly queue
Owner not available
Scope or SoW not agreed
Other - see comment
```

**AL — Reason check.** Flags a board that is on hold or past its date with no reason recorded.

```
=IF(OR(F17="Completed",F17="Cancelled"),"",IF(AND(OR(F17="On Hold",ISNUMBER(H17)),AK17=""),"Reason not given",""))
```

---

## The COMPLETED sheet still has the old order

COMPLETED still reads S1 Schematic, **S2 BOM Procurement**, S3 PCB Layout, and so on. The two
sheets now disagree about what S2 means, so a board changes stage numbers when it moves.

To match: on COMPLETED select columns **O:Q** (the BOM block), cut, then insert them after
column **AF**. The stage columns land on exactly the letters in the table above, and every
formula here works unchanged with row 6 in place of row 17.

Relabel the group headers in row 4 while you are there.

## One consequence of BOM being last

A board with BOM still open now reads as being at S7 with everything ahead of it closed —
Intel Arrow Island shows this today. If that is what you want, nothing to do. If BOM should
block earlier work instead, move it back to position 2 and the same formulas apply with the
stage names swapped.
