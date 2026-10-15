// Example diagrams for the File menu. Each is written in the text format the
// Render button understands, so they double as syntax demos. The MLB one is
// the HW7 diagram in mlb.js.
const ER_SAMPLES = {
  mlb: { name: 'MLB baseball (HW7)', text: loadMLBText },

  university: {
    name: 'University',
    text: () => `# University registration
# A section is weak on its course: "CS3610 section 01, fall" has no identity on its own.

ENTITY Student: *student_id, name, email, {phone}, gpa()
ENTITY Course: *course_id, title, credits:INT, department
ENTITY Instructor: *instructor_id, name, office
WEAK Section: ~term, ~section_no, room, capacity:INT

IDENT offers (Course, Section) 1:N partial/total
REL teaches (Instructor, Section) 1:N partial/total
REL enrolls_in (Student, Section) M:N partial/partial [grade, enrolled_on:DATE]
REL advises (Instructor, Student) 1:N partial/partial`
  },

  store: {
    name: 'Online store',
    text: () => `# Online store
# Line items are weak on their purchase; the M:N between suppliers and products carries an attribute.

ENTITY Customer: *customer_id, name, email, {address}
ENTITY Product: *product_id, name, price:DECIMAL, stock:INT
ENTITY Supplier: *supplier_id, name, contact_email
ENTITY Purchase: *purchase_id, purchase_date:DATE, status, total()
WEAK LineItem: ~line_no, quantity:INT, unit_price:DECIMAL

REL places (Customer, Purchase) 1:N partial/total
IDENT contains (Purchase, LineItem) 1:N total/total
REL for_product (Product, LineItem) 1:N partial/total
REL supplies (Supplier, Product) M:N partial/total [lead_days:INT]`
  }
};
