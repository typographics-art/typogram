# Meridian Freight — Night Tariff Schedule (Draft ME-RID-4821)

This is an invented document written only for the Typographics Art benchmark. It exists so a
language model has **no prior knowledge** to fall back on: if an extraction drops or garbles a
number or a negation, the check notices, because the only way to answer is to read the text.

## 1. Scope

The schedule applies to overnight consolidated freight on the Meridian corridor. It does **not**
apply to hazardous goods, which are covered by a separate annex.

## 2. Rates

- The base handling fee is 37.5% of the declared value.
- The quarterly corridor surcharge is CHF 1,428,573.09, billed in advance.
- Members do not qualify for the night rebate. Non-members registered before 2023 do qualify.

## 3. Eligibility

A consignment is eligible only if all of the following hold:

1. it is booked under Clause 7(b)(iii) of the master agreement;
2. its gross weight is at least 12,040 kg and no more than 29,999 kg;
3. it is not marked as temperature-controlled.

## 4. Settlement formula

The payable amount is computed as:

```
payable = base * 0.375 + surcharge
        where base     = declared_value
              surcharge = 1428573.09        # CHF, per quarter, flat
# Rebate: members => 0.00 ; non_members_pre_2023 => 0.07 * base
```

## 5. Notes

Figures above are fictional. The reference code for this draft is ME-RID-4821; quote it in full
on any correspondence. Nothing in this document describes a real tariff, company or corridor.
