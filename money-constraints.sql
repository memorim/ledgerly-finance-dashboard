CREATE TRIGGER IF NOT EXISTS invoice_money_insert BEFORE INSERT ON invoices
WHEN typeof(NEW.amount_cents)!='integer' OR NEW.amount_cents<1 OR NEW.amount_cents>100000000000
 OR ROUND(NEW.amount*100)!=NEW.amount_cents
 OR NEW.status NOT IN ('draft','sent','paid','overdue')
 OR NEW.due_date NOT GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'
 OR date(NEW.due_date,'+0 days') IS NOT NEW.due_date
BEGIN SELECT RAISE(ABORT,'invalid_invoice_money'); END;
CREATE TRIGGER IF NOT EXISTS invoice_money_update BEFORE UPDATE ON invoices
WHEN typeof(NEW.amount_cents)!='integer' OR NEW.amount_cents<1 OR NEW.amount_cents>100000000000
 OR ROUND(NEW.amount*100)!=NEW.amount_cents
 OR NEW.status NOT IN ('draft','sent','paid','overdue')
 OR NEW.due_date NOT GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'
 OR date(NEW.due_date,'+0 days') IS NOT NEW.due_date
BEGIN SELECT RAISE(ABORT,'invalid_invoice_money'); END;

CREATE TRIGGER IF NOT EXISTS transaction_money_insert BEFORE INSERT ON transactions
WHEN typeof(NEW.amount_cents)!='integer' OR NEW.amount_cents<1 OR NEW.amount_cents>100000000000
 OR length(trim(NEW.category))<1 OR length(NEW.category)>80 OR length(NEW.description)>500
 OR NEW.occurred_on NOT GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'
 OR date(NEW.occurred_on,'+0 days') IS NOT NEW.occurred_on
BEGIN SELECT RAISE(ABORT,'invalid_transaction_money'); END;
CREATE TRIGGER IF NOT EXISTS transaction_money_update BEFORE UPDATE ON transactions
WHEN typeof(NEW.amount_cents)!='integer' OR NEW.amount_cents<1 OR NEW.amount_cents>100000000000
 OR length(trim(NEW.category))<1 OR length(NEW.category)>80 OR length(NEW.description)>500
 OR NEW.occurred_on NOT GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'
 OR date(NEW.occurred_on,'+0 days') IS NOT NEW.occurred_on
BEGIN SELECT RAISE(ABORT,'invalid_transaction_money'); END;
